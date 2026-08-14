import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { del, get, put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { extractCv } from "@/lib/recruitment/extractCv";
import { renderScoutingDoc, type ScoutCandidate, type ScoutDocData } from "@/lib/recruitment/renderDoc";
import { buildAppendSystemPrompt, type JobSnapshot } from "@/lib/recruitment/systemPrompt";

// POST /api/recruitment/[slug]/add-cvs
//   body: { cvs: [{ url, name }] }
//
// Extends an existing scouting day with N additional candidates. The original
// pool's headlines / "everyone" probes / axes / cross-pool patterns stay put —
// they described the initial cohort, not this later top-up. New candidates are
// scored on the doc's existing axes so they sort alongside the originals; the
// LLM is given one-line summaries of every existing candidate as calibration.
//
// Team-scoring state (RecruitmentScoutState) is keyed by candidate id and
// survives untouched — the new candidates simply start unscored.
//
// Legacy blob-only docs (no DB row / no snapshotJson) cannot be extended; the
// caller must have a RecruitmentScoutingDay row.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { req: request });
  if (!(await can(ctx, "recruitment", "create"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const cvs: { url: string; name: string }[] = Array.isArray(body?.cvs) ? body.cvs : [];
  if (cvs.length === 0) return NextResponse.json({ error: "At least one CV is required" }, { status: 400 });
  for (const cv of cvs) {
    const u = new URL(cv.url);
    if (!u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.includes("recruitment/cv-tmp/")) {
      return NextResponse.json({ error: "Invalid CV reference" }, { status: 400 });
    }
  }

  const day = await prisma.recruitmentScoutingDay.findUnique({ where: { slug } });
  if (!day) return NextResponse.json({ error: "Scouting day not found (or a legacy blob-only doc that can't be extended)" }, { status: 404 });
  if (!day.jobSnapshotJson || !day.snapshotJson) {
    return NextResponse.json({ error: "This scouting day is missing its saved snapshot — extend not supported" }, { status: 400 });
  }

  const snapshot = day.jobSnapshotJson as unknown as JobSnapshot;
  const existing = day.snapshotJson as unknown as ScoutDocData;
  const existingIds = new Set(existing.candidates.map((c) => c.id));
  const existingSummaries = existing.candidates.map(
    (c) => `${c.name} (id: ${c.id}, code: ${c.code}) — ${c.pos}${c.meta ? " · " + c.meta : ""}`,
  );

  // 1. Extract each new CV
  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Interview-day title: ${day.title}`,
        day.matchday ? `Interview date: ${day.matchday.toISOString().slice(0, 10)}` : null,
        `Existing pool size: ${existing.candidates.length}`,
        `Number of NEW candidates to score: ${cvs.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  for (let i = 0; i < cvs.length; i++) {
    const got = await get(cvs[i].url, { access: "private" });
    if (got?.statusCode !== 200) {
      return NextResponse.json({ error: `Could not read CV "${cvs[i].name}"` }, { status: 502 });
    }
    const buffer = Buffer.from(await new Response(got.stream).arrayBuffer());
    const { text, images } = await extractCv(buffer);
    userContent.push({ type: "text", text: `=== NEW CV ${i + 1} of ${cvs.length}: ${cvs[i].name} ===\n${text || "(scanned — see page images below)"}` });
    for (const img of images) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.buffer.toString("base64") },
      });
    }
  }

  // 2. Claude — append mode
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 16_000,
    system: buildAppendSystemPrompt(snapshot, existing.axes, existingSummaries),
    messages: [{ role: "user", content: userContent }],
  });
  const msg = await stream.finalMessage();
  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { candidates: ScoutCandidate[] };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  } catch {
    console.error("[recruitment-add-cvs] unparseable model output:", raw.slice(0, 500));
    return NextResponse.json({ error: "Model returned unparseable output — try again" }, { status: 502 });
  }
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    return NextResponse.json({ error: "Model returned no new candidates — try again" }, { status: 502 });
  }

  // 3. Dedupe ids against existing pool + within the new batch. If the model
  // reused an existing id despite the instruction, suffix -2/-3 until unique.
  const seenIds = new Set(existingIds);
  const addedCandidates: ScoutCandidate[] = parsed.candidates.map((c) => {
    let id = c.id;
    for (let n = 2; seenIds.has(id); n++) id = `${c.id}-${n}`;
    seenIds.add(id);
    return { ...c, id };
  });

  // 4. Merge + re-render + overwrite blob + update DB
  const merged: ScoutDocData = { ...existing, candidates: [...existing.candidates, ...addedCandidates] };
  const html = renderScoutingDoc(slug, merged);
  const putResult = await put(`recruitment/docs/${slug}.html`, html, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/html; charset=utf-8",
  });
  await prisma.recruitmentScoutingDay.update({
    where: { slug },
    data: {
      snapshotJson: merged as unknown as never,
      renderedBlobUrl: putResult.url,
    },
  });

  // 5. Clean up temp CVs (best-effort)
  await Promise.allSettled(cvs.map((cv) => del(cv.url)));

  return NextResponse.json({ slug, addedCount: addedCandidates.length });
}

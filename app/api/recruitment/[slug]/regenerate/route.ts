import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { del, get, put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { extractCv } from "@/lib/recruitment/extractCv";
import { renderScoutingDoc, type ScoutCandidate, type ScoutDocData } from "@/lib/recruitment/renderDoc";
import { buildRegenerateSystemPrompt, type JobSnapshot } from "@/lib/recruitment/systemPrompt";

// POST /api/recruitment/[slug]/regenerate
//   body: { cvs: [{ url, name }] }
//
// Full re-scout of the pool: fresh axes, headlines, "everyone" probes, and
// re-scores. Existing candidates come with only their prior scout notes as
// pseudo-CV evidence (we don't keep original CVs); new candidates come with
// fresh CV extracts. Existing candidate ids are preserved so the team's
// saved RecruitmentScoutState rows stay linked.
//
// Trade-off vs. add-cvs: cross-pool insights (axes/headlines/everyone) refresh
// to reflect the full pool, but existing candidates are re-scored on
// possibly-new axes with weaker evidence — their attrs may shift.

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
  // Regenerating with zero new CVs is valid — you might just want fresh axes /
  // headlines on the existing pool. But if all CVs are missing AND the pool
  // is empty, there's nothing to scout.
  for (const cv of cvs) {
    const u = new URL(cv.url);
    if (!u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.includes("recruitment/cv-tmp/")) {
      return NextResponse.json({ error: "Invalid CV reference" }, { status: 400 });
    }
  }

  const day = await prisma.recruitmentScoutingDay.findUnique({ where: { slug } });
  if (!day) return NextResponse.json({ error: "Scouting day not found (or a legacy blob-only doc that can't be regenerated)" }, { status: 404 });
  if (!day.jobSnapshotJson || !day.snapshotJson) {
    return NextResponse.json({ error: "This scouting day is missing its saved snapshot — regenerate not supported" }, { status: 400 });
  }
  const snapshot = day.jobSnapshotJson as unknown as JobSnapshot;
  const existing = day.snapshotJson as unknown as ScoutDocData;

  if (cvs.length === 0 && existing.candidates.length === 0) {
    return NextResponse.json({ error: "Nothing to scout — the pool is empty and no new CVs provided" }, { status: 400 });
  }

  // 1. User message: pool header + prior scout evidence for existing
  //    candidates + fresh CV extracts for the new ones.
  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Interview-day title: ${day.title}`,
        day.matchday ? `Interview date: ${day.matchday.toISOString().slice(0, 10)}` : null,
        `Prior pool size: ${existing.candidates.length}`,
        `New CVs to add: ${cvs.length}`,
        `Total pool to scout: ${existing.candidates.length + cvs.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  if (existing.candidates.length > 0) {
    const dossier = existing.candidates
      .map((c) => {
        return [
          `--- EXISTING CANDIDATE — id: ${c.id}, code: ${c.code} ---`,
          `Name: ${c.name}`,
          `Prior meta: ${c.meta}`,
          `Prior positional read: ${c.pos}`,
          `Prior flags: ${(c.flags || []).map(([sev, txt]) => `[${sev}] ${txt}`).join(" | ") || "(none)"}`,
          `Prior scout notes: ${c.scout}`,
        ].join("\n");
      })
      .join("\n\n");
    userContent.push({
      type: "text",
      text: `Existing candidates — you MUST reuse the exact ids above in your output for these people so team scores stay linked. Evidence is limited to what's here; do not invent new facts.\n\n${dossier}`,
    });
  }

  for (let i = 0; i < cvs.length; i++) {
    const got = await get(cvs[i].url, { access: "private" });
    if (got?.statusCode !== 200) {
      return NextResponse.json({ error: `Could not read CV "${cvs[i].name}"` }, { status: 502 });
    }
    const buffer = Buffer.from(await new Response(got.stream).arrayBuffer());
    const { text, images } = await extractCv(buffer);
    userContent.push({
      type: "text",
      text: `=== NEW CV ${i + 1} of ${cvs.length}: ${cvs[i].name} ===\n${text || "(scanned — see page images below)"}`,
    });
    for (const img of images) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.buffer.toString("base64") },
      });
    }
  }

  // 2. Claude — full regenerate
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 24_000,
    system: buildRegenerateSystemPrompt(snapshot),
    messages: [{ role: "user", content: userContent }],
  });
  const msg = await stream.finalMessage();
  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let data: ScoutDocData;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  } catch {
    console.error("[recruitment-regenerate] unparseable model output:", raw.slice(0, 500));
    return NextResponse.json({ error: "Model returned unparseable output — try again" }, { status: 502 });
  }
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
    return NextResponse.json({ error: "Model returned no candidates — try again" }, { status: 502 });
  }
  data.selector = session!.user?.name || existing.selector || "The Selector";

  // 3. Safety net: enforce existing-id preservation. The prompt tells the LLM
  // to reuse ids for existing candidates by name; if it forgot, best-effort
  // remap by lowercase name so team scores don't orphan.
  const existingByName = new Map(
    existing.candidates.map((c) => [c.name.trim().toLowerCase(), c]),
  );
  const seenIds = new Set<string>();
  data.candidates = data.candidates.map((c: ScoutCandidate) => {
    const prior = existingByName.get((c.name || "").trim().toLowerCase());
    let id = prior?.id ?? c.id;
    // If still colliding within the batch, suffix.
    for (let n = 2; seenIds.has(id); n++) id = `${prior?.id ?? c.id}-${n}`;
    seenIds.add(id);
    return { ...c, id };
  });

  // 4. Overwrite blob + DB row
  const html = renderScoutingDoc(slug, data);
  const putResult = await put(`recruitment/docs/${slug}.html`, html, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/html; charset=utf-8",
  });
  await prisma.recruitmentScoutingDay.update({
    where: { slug },
    data: {
      snapshotJson: data as unknown as never,
      renderedBlobUrl: putResult.url,
    },
  });

  // 5. Clean up temp CVs (best-effort)
  await Promise.allSettled(cvs.map((cv) => del(cv.url)));

  return NextResponse.json({
    slug,
    addedCount: cvs.length,
    totalCount: data.candidates.length,
  });
}

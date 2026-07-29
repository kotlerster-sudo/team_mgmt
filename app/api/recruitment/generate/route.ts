import { NextRequest, NextResponse } from "next/server";
import { access } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { del, getDownloadUrl, list, put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";
import { extractCv } from "@/lib/recruitment/extractCv";
import { renderScoutingDoc, type ScoutDocData } from "@/lib/recruitment/renderDoc";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `You are a senior talent scout producing a "scouting desk" briefing for an interview day at a non-profit field-operations organisation (urban settlement work in Indian cities: elderly care, homelessness, welfare rights, food, water, sanitation, creches).

The briefing uses a football-scouting metaphor throughout: candidates are trialists, the role is a shirt, the hiring manager is the selector. Witty but never at the expense of substance — every claim must be grounded in the CV evidence, and unverifiable or suspicious claims become flags, not jokes.

You will receive the role context and one CV per candidate (text extract, or page images for scanned CVs). Return ONLY a JSON object — no markdown fences, no commentary — with this exact shape:

{
  "docTitle": string,        // browser tab title, e.g. "RP Trials · Chennai Urban — Scouting Day"
  "matchday": string,        // e.g. "Matchday · Thu 30 July 2026" (use the interview date given)
  "titleA": string,          // headline line 1, e.g. "RP Trials"
  "titleB": string,          // headline line 2 — a football-club twist on the team/city, e.g. "Chennai Urban FC"
  "sub": string,             // e.g. "8 trialists · 1 shirt · position: <b>Resource Person (box-to-box)</b>"
  "axes": [string x6],       // 6 radar axis labels, UPPERCASE, max 7 chars each. Pick axes that discriminate THIS pool for THIS role, e.g. ["FIELD","RANGE","DOCS","DEPTH","STABLE","CHN FIT"]
  "headlines": [string],     // 5–8 ticker headlines, UPPERCASE tabloid-transfer-news style, each surfacing a REAL cross-pool pattern or a candidate-specific alert
  "everyone": [string],      // 2–4 paragraphs of probes to put to EVERY candidate, each starting "<b>1. Name of test:</b> …". Derive from patterns across the pool (e.g. many hold Manager titles → motivation probe)
  "candidates": [
    {
      "id": string,          // kebab-case short id from the name
      "code": string,        // application/reference number from the CV if present, else "01".."NN"
      "name": string,
      "pos": string,         // football position metaphor capturing their profile, e.g. "Box-to-box grafter", "Veteran captain · systems brain", "Hyped academy prospect"
      "meta": string,        // "~5 yrs · City · Highest qualification, Institution"
      "attrs": [number x6],  // 0–100 per axis, honest spread — do not cluster everyone at 60–80
      "flags": [["r"|"y", string]], // 1–3 flags. "r" = serious (unexplained gaps, overlapping employment dates, likely misrepresentation, conflict-of-interest optics). "y" = caution (relocation, title inversion, thin urban experience, retention risk). May use <b>.
      "scout": string,       // 60–110 word scout's report: what the evidence actually shows, strongest asset, core doubt. May use <b> for emphasis. Reference concrete numbers/orgs from the CV.
      "qs": [string]         // 5 sharp interview questions, each anchored in something specific in THIS CV: verify suspicious claims first, then depth probes, then fit/practicals (relocation, salary, motivation). Include a "PRE-WORK (internal): …" item if something must be checked before the interview.
    }
  ]
}

Rules:
- Order candidates from strongest to weakest overall read.
- Scrutinise every CV for: date overlaps between roles, unexplained gaps, designation inflation, donor-facing language masking thin field time, org-hopping patterns. These drive flags and questions.
- The only HTML allowed anywhere is <b>…</b>.
- attrs must reflect the evidence: a candidate with no urban field experience scores low on the field axis even if otherwise impressive.
- Questions are for the interviewer to read aloud — direct, specific, no filler.`;

async function uniqueSlug(base: string): Promise<string> {
  const taken = new Set<string>();
  try {
    const { blobs } = await list({ prefix: "recruitment/docs/" });
    for (const b of blobs) {
      const m = b.pathname.match(/^recruitment\/docs\/([a-z0-9-]+)\.html$/);
      if (m) taken.add(m[1]);
    }
  } catch {
    /* blob store unreachable — fs check below still applies */
  }
  let slug = base;
  for (let n = 2; ; n++) {
    const onFs = await access(path.join(process.cwd(), "content", "recruitment", `${slug}.html`))
      .then(() => true)
      .catch(() => false);
    if (!onFs && !taken.has(slug)) return slug;
    slug = `${base}-${n}`;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const title = String(body?.title || "").trim();
  const date = String(body?.date || "").trim();
  const context = String(body?.context || "").trim();
  const cvs: { url: string; name: string }[] = Array.isArray(body?.cvs) ? body.cvs : [];
  if (!title || cvs.length === 0) {
    return NextResponse.json({ error: "Title and at least one CV are required" }, { status: 400 });
  }
  for (const cv of cvs) {
    const u = new URL(cv.url);
    if (!u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.includes("recruitment/cv-tmp/")) {
      return NextResponse.json({ error: "Invalid CV reference" }, { status: 400 });
    }
  }

  // 1. Pull + extract each CV
  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Interview-day title: ${title}`,
        date ? `Interview date: ${date}` : null,
        context ? `Additional context from the selector:\n${context}` : null,
        `Number of candidates: ${cvs.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  for (let i = 0; i < cvs.length; i++) {
    const res = await fetch(getDownloadUrl(cvs[i].url));
    if (!res.ok) return NextResponse.json({ error: `Could not read CV "${cvs[i].name}"` }, { status: 502 });
    const buffer = Buffer.from(await res.arrayBuffer());
    const { text, images } = await extractCv(buffer);
    userContent.push({ type: "text", text: `=== CV ${i + 1} of ${cvs.length}: ${cvs[i].name} ===\n${text || "(scanned — see page images below)"}` });
    for (const img of images) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.buffer.toString("base64") },
      });
    }
  }

  // 2. One Claude call → scouting JSON
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 24_000,
    system: SYSTEM,
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
    console.error("[recruitment-generate] unparseable model output:", raw.slice(0, 500));
    return NextResponse.json({ error: "Model returned unparseable output — try again" }, { status: 502 });
  }
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
    return NextResponse.json({ error: "Model returned no candidates — try again" }, { status: 502 });
  }
  data.selector = session!.user?.name || "The Selector";

  // 3. Render + persist to the private doc store
  const base =
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "scouting-day";
  const slug = await uniqueSlug(base);
  const html = renderScoutingDoc(slug, data);
  await put(`recruitment/docs/${slug}.html`, html, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/html; charset=utf-8",
  });

  // 4. Clean up temp CVs (best-effort)
  await Promise.allSettled(cvs.map((cv) => del(cv.url)));

  return NextResponse.json({ slug });
}

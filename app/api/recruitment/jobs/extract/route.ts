import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { get } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import { extractJd } from "@/lib/recruitment/extractJd";

// POST /api/recruitment/jobs/extract
//   body: { url: string, name: string, mediaType?: string }
//   returns: { fields: ExtractedJdFields, notes: string, lowConfidenceFields: string[] }
//
// Fetches the private blob, runs mupdf/mammoth/image-passthrough, then a
// single Claude call to structure the fields the JD form uses. Kept separate
// from POST /api/recruitment/jobs so the caller can preview + edit before
// committing the row. `sourceDocUrl` is echoed back so the client can pass it
// to the create call.

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM = `You are extracting a job description into a structured schema so a recruiter can review + tweak it before saving.

You will receive the JD as either text (from a PDF/DOCX) and/or image blocks (screenshot or scanned PDF). If the JD is in a language other than English, TRANSLATE the extracted fields to English but preserve original job titles verbatim. Do not invent facts — if a field is not present in the JD, leave it empty.

Return ONLY a JSON object — no markdown fences, no commentary — matching this exact schema:

{
  "fields": {
    "title": string,                    // job title, verbatim; "" if not present
    "seniority": "entry" | "mid" | "senior" | "lead" | "",
    "locationHint": string,             // any city/state/country the JD mentions; "" if none. The recruiter picks the actual Location row.
    "dayToDay": string,                 // markdown — 3-8 bullets or short paragraphs of what the role does. "" if unclear.
    "mustHaves": [string],              // hard requirements. Empty array if unclear.
    "niceToHaves": [string],            // preferred but not required. Empty array if unclear.
    "hardDisqualifiers": [string],      // instant no. Only include if the JD explicitly states them.
    "salaryBand": string,               // "" if not disclosed. Preserve currency + period as written (e.g. "₹22-28k/mo").
    "theme": "football" | "neutral",    // "football" if the org tone reads playful/informal, "neutral" otherwise. Default to "neutral" if unsure.
    "notes": string,                    // any org/context info the JD gives that doesn't fit above.
    "redFlagRules": [string],           // role-specific red flags implied by the JD (e.g. "no direct experience with children in a creche role"). Empty if none obvious.
    "yellowFlagRules": [string],        // role-specific yellow flags. Empty if none obvious.
    "scrutiniseFor": [string]           // things the interviewer should probe based on the JD's requirements. Empty if none obvious.
  },
  "notes": string,                      // 1-3 sentence assessment of the JD's completeness — what's missing that a good scout would want to know.
  "lowConfidenceFields": [string]       // list any field names (e.g. "dayToDay", "salaryBand") that you populated with low confidence so the reviewer knows to double-check.
}

Rules:
- Bias toward EMPTY over guessed. A blank field is fine; a hallucinated field is not.
- mustHaves + niceToHaves + hardDisqualifiers should be short, one-line items — not paragraphs.
- Do not populate "lockedAxes" — that's a recruiter judgment call, not extractable from a JD.
- If the input is clearly not a job description (invoice, resume, random doc), return the schema with title="" and put an explanation in "notes".`;

type ExtractedFields = {
  title: string;
  seniority: "" | "entry" | "mid" | "senior" | "lead";
  locationHint: string;
  dayToDay: string;
  mustHaves: string[];
  niceToHaves: string[];
  hardDisqualifiers: string[];
  salaryBand: string;
  theme: "football" | "neutral";
  notes: string;
  redFlagRules: string[];
  yellowFlagRules: string[];
  scrutiniseFor: string[];
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await buildRbacContext(await auth(), { req: request });
  if (!(await can(ctx, "recruitment", "create"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const url = String(body?.url || "").trim();
  const name = String(body?.name || "jd").trim();
  const mediaType = String(body?.mediaType || "").trim();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const u = new URL(url);
  if (!u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.includes("recruitment/jd-tmp/")) {
    return NextResponse.json({ error: "Invalid JD reference" }, { status: 400 });
  }

  // Fetch the JD from the private store — same auth quirk as CVs (a plain
  // fetch of the URL 401s; the get() helper carries the store token).
  const got = await get(url, { access: "private" });
  if (got?.statusCode !== 200) {
    return NextResponse.json({ error: `Could not read JD "${name}"` }, { status: 502 });
  }
  const buffer = Buffer.from(await new Response(got.stream).arrayBuffer());
  const inferredMediaType = mediaType || got.blob?.contentType || guessMediaType(name);
  const { text, images } = await extractJd(buffer, inferredMediaType);

  const userContent: Anthropic.ContentBlockParam[] = [];
  if (text) userContent.push({ type: "text", text: `JD source (${name}):\n\n${text}` });
  for (const img of images) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.buffer.toString("base64") },
    });
  }
  if (userContent.length === 0) {
    return NextResponse.json({ error: "JD had no readable text or pages" }, { status: 400 });
  }

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 8_000,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });
  const msg = await stream.finalMessage();
  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { fields: ExtractedFields; notes?: string; lowConfidenceFields?: string[] };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  } catch {
    console.error("[jd-extract] unparseable model output:", raw.slice(0, 500));
    return NextResponse.json({ error: "Model returned unparseable output — try again or fill the JD by hand" }, { status: 502 });
  }

  // Normalise: coerce array fields, clamp seniority + theme to enum values,
  // strip anything the model tried to invent outside the schema.
  const f = parsed.fields || ({} as ExtractedFields);
  const fields: ExtractedFields = {
    title: String(f.title || "").trim(),
    seniority: (["entry", "mid", "senior", "lead"] as const).includes(f.seniority as never)
      ? (f.seniority as ExtractedFields["seniority"])
      : "",
    locationHint: String(f.locationHint || "").trim(),
    dayToDay: String(f.dayToDay || ""),
    mustHaves: Array.isArray(f.mustHaves) ? f.mustHaves.map((s) => String(s).trim()).filter(Boolean) : [],
    niceToHaves: Array.isArray(f.niceToHaves) ? f.niceToHaves.map((s) => String(s).trim()).filter(Boolean) : [],
    hardDisqualifiers: Array.isArray(f.hardDisqualifiers) ? f.hardDisqualifiers.map((s) => String(s).trim()).filter(Boolean) : [],
    salaryBand: String(f.salaryBand || "").trim(),
    theme: f.theme === "football" ? "football" : "neutral",
    notes: String(f.notes || ""),
    redFlagRules: Array.isArray(f.redFlagRules) ? f.redFlagRules.map((s) => String(s).trim()).filter(Boolean) : [],
    yellowFlagRules: Array.isArray(f.yellowFlagRules) ? f.yellowFlagRules.map((s) => String(s).trim()).filter(Boolean) : [],
    scrutiniseFor: Array.isArray(f.scrutiniseFor) ? f.scrutiniseFor.map((s) => String(s).trim()).filter(Boolean) : [],
  };

  return NextResponse.json({
    fields,
    notes: parsed.notes || "",
    lowConfidenceFields: Array.isArray(parsed.lowConfidenceFields)
      ? parsed.lowConfidenceFields.map((s) => String(s))
      : [],
    sourceDocUrl: url,
    sourceDocName: name,
  });
}

function guessMediaType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".doc")) return "application/msword";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

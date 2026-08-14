/**
 * SYSTEM prompt assembly for the /recruitment scouting-desk generator.
 *
 * Previously a single hardcoded string in `app/api/recruitment/generate/route.ts`
 * that baked in the NGO/urban-settlement framing, the football metaphor, and
 * the NGO-flavoured flag rubric. Now assembled per request from a JD + Location
 * pair so the same pipeline can serve any role in any city.
 *
 * Composition (in order): base voice → theme block → JD block → rubric block →
 * scrutinise block → axes rule → output schema. Rubric fields on the JD exist
 * from Phase 1 but the prompt still injects generic defaults — per-JD rubric
 * wiring is Phase 3. Same for lockedAxes.
 */

import type { RecruitmentJob, RecruitmentLocation } from "@/app/generated/prisma/client";

// ── Input types ──────────────────────────────────────────────────────────────

/**
 * A JD snapshot as it's frozen into a scouting day at generation time. Uses a
 * plain shape (not the Prisma row) so we can pass either the live JD or the
 * frozen snapshot without a mapping step. Mirrors the JSON we persist in
 * RecruitmentScoutingDay.jobSnapshotJson.
 */
export type JobSnapshot = {
  title: string;
  seniority: string | null;
  dayToDay: string;
  mustHaves: string[];
  niceToHaves: string[];
  hardDisqualifiers: string[];
  salaryBand: string | null;
  theme: "football" | "neutral";
  notes: string;
  redFlagRules: string[];
  yellowFlagRules: string[];
  scrutiniseFor: string[];
  lockedAxes: string[];
  location: {
    city: string;
    state: string | null;
    country: string;
    primaryLanguage: string | null;
    localReferenceOrgs: string[];
    localRedFlags: string[];
    mobilityDefault: string | null;
    notes: string;
  };
};

/** Build a JobSnapshot from live Prisma rows — used at generation time. */
export function jobSnapshotFromRow(
  job: RecruitmentJob,
  location: RecruitmentLocation,
): JobSnapshot {
  return {
    title: job.title,
    seniority: job.seniority,
    dayToDay: job.dayToDay,
    mustHaves: job.mustHaves,
    niceToHaves: job.niceToHaves,
    hardDisqualifiers: job.hardDisqualifiers,
    salaryBand: job.salaryBand,
    theme: (job.theme === "neutral" ? "neutral" : "football"),
    notes: job.notes,
    redFlagRules: job.redFlagRules,
    yellowFlagRules: job.yellowFlagRules,
    scrutiniseFor: job.scrutiniseFor,
    lockedAxes: job.lockedAxes,
    location: {
      city: location.city,
      state: location.state,
      country: location.country,
      primaryLanguage: location.primaryLanguage,
      localReferenceOrgs: location.localReferenceOrgs,
      localRedFlags: location.localRedFlags,
      mobilityDefault: location.mobilityDefault,
      notes: location.notes,
    },
  };
}

// ── Prompt fragments ─────────────────────────────────────────────────────────

const BASE_VOICE = `You are a senior talent scout producing a "scouting desk" briefing for an interview day.

You will receive the role context and one CV per candidate (text extract, or page images for scanned CVs). Return ONLY a JSON object — no markdown fences, no commentary — matching the schema at the bottom of this prompt.`;

const THEME_FOOTBALL = `Voice: use a football-scouting metaphor throughout. Candidates are trialists, the role is a shirt, the hiring manager is the selector, the interview day is matchday, positional metaphors describe candidate profiles ("box-to-box grafter", "veteran captain · systems brain", "hyped academy prospect"). Witty but never at the expense of substance — every claim must be grounded in the CV evidence, and unverifiable or suspicious claims become flags, not jokes.`;

const THEME_NEUTRAL = `Voice: professional, direct, no metaphors. Same output structure. Every claim must be grounded in the CV evidence; unverifiable or suspicious claims become flags, not commentary.`;

/** Generic scrutinise-for baseline — always applied, JD may add more (Phase 3). */
const DEFAULT_SCRUTINISE = [
  "date overlaps between roles",
  "unexplained gaps",
  "designation inflation",
  "org-hopping patterns",
  "claims the CV can't substantiate",
];

/** Generic red-flag baseline. JD-supplied rules append (Phase 3). */
const DEFAULT_RED_FLAGS = [
  "unexplained gaps",
  "overlapping employment dates",
  "likely misrepresentation",
  "conflict-of-interest optics",
];

/** Generic yellow-flag baseline. JD-supplied rules append (Phase 3). */
const DEFAULT_YELLOW_FLAGS = [
  "relocation friction",
  "title inversion",
  "thin experience against role requirements",
  "retention risk",
];

const OUTPUT_SCHEMA = `Output schema (exact shape):

{
  "docTitle": string,        // browser tab title, e.g. "RP Trials · Chennai Urban — Scouting Day"
  "matchday": string,        // e.g. "Matchday · Thu 30 July 2026" (use the interview date given)
  "titleA": string,          // headline line 1, e.g. "RP Trials"
  "titleB": string,          // headline line 2 — for football theme, a football-club twist on the team/city, e.g. "Chennai Urban FC"; for neutral theme, a straightforward subtitle
  "sub": string,             // e.g. "8 trialists · 1 shirt · position: <b>Resource Person (box-to-box)</b>"
  "axes": [string x6],       // 6 radar axis labels, UPPERCASE, max 7 chars each
  "headlines": [string],     // 5–8 ticker headlines, UPPERCASE tabloid style, each surfacing a REAL cross-pool pattern or a candidate-specific alert
  "everyone": [string],      // 2–4 paragraphs of probes to put to EVERY candidate, each starting "<b>1. Name of test:</b> …". Derive from patterns across the pool
  "candidates": [
    {
      "id": string,          // kebab-case short id from the name
      "code": string,        // application/reference number from the CV if present, else "01".."NN"
      "name": string,
      "pos": string,         // profile in a phrase (football-position metaphor if theme=football; a plain profile line otherwise)
      "meta": string,        // "~5 yrs · City · Highest qualification, Institution"
      "attrs": [number x6],  // 0–100 per axis, honest spread — do not cluster everyone at 60–80
      "flags": [["r"|"y", string]], // 1–3 flags. "r" = serious, "y" = caution. May use <b>.
      "scout": string,       // 60–110 word scout's report: what the evidence shows, strongest asset, core doubt. May use <b>. Reference concrete numbers/orgs from the CV.
      "qs": [string]         // 5 sharp interview questions, each anchored in something specific in THIS CV: verify suspicious claims first, then depth probes, then fit/practicals. May include a "PRE-WORK (internal): …" item.
    }
  ]
}

General rules:
- Order candidates from strongest to weakest overall read.
- The only HTML allowed anywhere is <b>…</b>.
- attrs must reflect the evidence: a candidate weak on a role-critical dimension scores low on that axis even if otherwise impressive.
- Questions are for the interviewer to read aloud — direct, specific, no filler.`;

// ── Block builders ───────────────────────────────────────────────────────────

function themeBlock(theme: "football" | "neutral"): string {
  return theme === "football" ? THEME_FOOTBALL : THEME_NEUTRAL;
}

function jdBlock(job: JobSnapshot): string {
  const loc = job.location;
  const locLine = [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
  const lines: string[] = [
    `Role: ${job.title}${job.seniority ? ` (${job.seniority})` : ""}`,
    `Location: ${locLine}${loc.primaryLanguage ? ` · primary language: ${loc.primaryLanguage}` : ""}`,
  ];
  if (loc.mobilityDefault) lines.push(`Mobility expectation: ${loc.mobilityDefault}`);
  if (job.salaryBand) lines.push(`Salary band: ${job.salaryBand}`);
  if (job.dayToDay.trim()) lines.push(`\nWhat the role does day-to-day:\n${job.dayToDay.trim()}`);
  if (job.mustHaves.length) lines.push(`\nMust-haves:\n${job.mustHaves.map((s) => `- ${s}`).join("\n")}`);
  if (job.niceToHaves.length) lines.push(`\nNice-to-haves:\n${job.niceToHaves.map((s) => `- ${s}`).join("\n")}`);
  if (job.hardDisqualifiers.length) lines.push(`\nHard disqualifiers (instant no):\n${job.hardDisqualifiers.map((s) => `- ${s}`).join("\n")}`);
  if (loc.localReferenceOrgs.length) {
    lines.push(`\nLocal reference orgs a serious candidate could plausibly cite:\n${loc.localReferenceOrgs.map((s) => `- ${s}`).join("\n")}`);
  }
  if (loc.notes.trim()) lines.push(`\nLocation context:\n${loc.notes.trim()}`);
  if (job.notes.trim()) lines.push(`\nAdditional context from the selector:\n${job.notes.trim()}`);
  return `Role context:\n${lines.join("\n")}`;
}

function rubricBlock(job: JobSnapshot): string {
  // Phase 1: JD-supplied rules append to defaults. Phase 3 will let JD rules
  // replace defaults per role (e.g. a startup engineer role that treats
  // org-hopping as a feature, not a red flag).
  const red = [...DEFAULT_RED_FLAGS, ...job.redFlagRules];
  const yellow = [...DEFAULT_YELLOW_FLAGS, ...job.yellowFlagRules];
  return [
    "Flag rubric:",
    `- "r" (red / serious): ${red.join("; ")}`,
    `- "y" (yellow / caution): ${yellow.join("; ")}`,
    "1–3 flags per candidate, drawn from the CV evidence.",
  ].join("\n");
}

function scrutiniseBlock(job: JobSnapshot): string {
  const items = [...DEFAULT_SCRUTINISE, ...job.scrutiniseFor, ...job.location.localRedFlags];
  return `Scrutinise every CV for: ${items.join("; ")}. These drive the flags and interview questions.`;
}

function axesRule(job: JobSnapshot): string {
  if (job.lockedAxes.length === 6) {
    return `Radar axes: use EXACTLY these 6 in this order, UPPERCASE, max 7 chars each — ${job.lockedAxes.map((a) => `"${a}"`).join(", ")}. Score each candidate 0–100 per axis based on CV evidence.`;
  }
  return `Radar axes: pick 6 axis labels that best discriminate THIS pool for THIS role. UPPERCASE, max 7 chars each. Example shape (do not copy verbatim): ["FIELD","RANGE","DOCS","DEPTH","STABLE","LOCAL"]. Score each candidate 0–100 per axis with an honest spread — do not cluster everyone at 60–80.`;
}

// ── Public builder ───────────────────────────────────────────────────────────

/** Assemble the full SYSTEM prompt for a scouting-day generation. */
export function buildSystemPrompt(job: JobSnapshot): string {
  return [
    BASE_VOICE,
    "",
    themeBlock(job.theme),
    "",
    jdBlock(job),
    "",
    rubricBlock(job),
    "",
    scrutiniseBlock(job),
    "",
    axesRule(job),
    "",
    OUTPUT_SCHEMA,
  ].join("\n");
}

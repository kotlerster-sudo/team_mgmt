// Seed the default recruitment Location + JD that preserves the pre-Phase-1
// SYSTEM-prompt framing (NGO / urban-settlement / Chennai · Resource Person).
// Idempotent — safe to re-run. Guards against .env hoisting via the pattern
// documented in [[scripts_prisma_dotenv_hoisting]].
//
// Run:   pnpm tsx prisma/seed-recruitment-defaults.ts
//
// NOTE: .env.local == prod DB. Re-running this is safe (upsert), but any
// mutation to the seeded rows here is not applied on re-run because we only
// touch missing fields — see `update: {}` below.

import "dotenv/config";

async function main() {
  const { default: prisma } = await import("../lib/prisma");

  const chennai = await prisma.recruitmentLocation.upsert({
    where: { slug: "chennai-tamil-nadu" },
    create: {
      slug: "chennai-tamil-nadu",
      city: "Chennai",
      state: "Tamil Nadu",
      country: "IN",
      primaryLanguage: "Tamil",
      mobilityDefault: "own-two-wheeler",
      localReferenceOrgs: [
        "MS Swaminathan Research Foundation",
        "Anna University",
        "IIT Madras",
        "Loyola College",
        "Madras Institute of Development Studies",
      ],
      localRedFlags: [
        "Zero prior Chennai residence for a coastal-humidity, Tamil-primary field role",
        "Only commercial-sector experience with no NGO field exposure",
      ],
      notes: "Chennai urban settlement work — coastal humidity, dense low-income neighbourhoods (Royapuram, Perambur), Tamil is the primary field language.",
    },
    update: {},
  });

  await prisma.recruitmentJob.upsert({
    where: { slug: "resource-person-urban-ops-chennai" },
    create: {
      slug: "resource-person-urban-ops-chennai",
      title: "Resource Person · Urban Ops",
      seniority: "entry",
      locationId: chennai.id,
      theme: "football",
      dayToDay: [
        "- Daily rounds across an assigned cluster of settlements (elderly care, homelessness, welfare-rights, food, water, sanitation, creches).",
        "- Enrolments, visit-based observations, follow-ups on action points raised at previous visits.",
        "- Coordinating with local caregivers, welfare officers, and partner orgs.",
        "- Field-week + team-day rhythm — Mondays or Tuesdays in office; rest in the field.",
      ].join("\n"),
      mustHaves: [
        "Prior field exposure — NGO, community-health, welfare, or civic-participation work",
        "Fluent Tamil; comfortable in low-resource, dense settlement contexts",
        "Comfortable with structured documentation (checklists, observation notes)",
        "Owns or is willing to operate a two-wheeler",
      ],
      niceToHaves: [
        "Prior work with any of the domain areas (elderly, creches, sanitation, water, food, welfare rights)",
        "Prior Chennai residence",
        "Basic English + spreadsheet fluency",
      ],
      hardDisqualifiers: [
        "No prior field-work experience at all",
        "Cannot commit to a 6-day field week",
      ],
      notes: "Non-profit field-operations organisation doing urban settlement work in Indian cities: elderly care, homelessness, welfare rights, food, water, sanitation, creches. The Resource Person is a box-to-box role — enrolment, observation, follow-up all rolled into one.",
      // Rubric fields — populated with the NGO-flavoured items previously baked
      // into the SYSTEM prompt. Wired into the prompt from Phase 3.
      redFlagRules: [
        "Donor-facing language masking thin field time",
        "Overlapping employment dates between roles",
        "Conflict-of-interest optics with named local partners",
      ],
      yellowFlagRules: [
        "Relocation friction to Chennai",
        "Title inversion (was Manager, applying as RP)",
        "Thin urban-settlement experience",
        "Retention risk (short recent tenures)",
      ],
      scrutiniseFor: [
        "Donor-facing language masking thin field time",
        "Depth vs. name-dropping (concrete numbers vs. vague scope claims)",
      ],
      lockedAxes: [], // empty — model picks 6 axes per pool (default)
    },
    update: {},
  });

  console.log("[seed-recruitment-defaults] Chennai location + RP Urban Ops JD upserted.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(async () => {
    const { default: prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });

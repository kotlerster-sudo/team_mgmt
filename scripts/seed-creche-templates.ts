/**
 * Updates the two Creche programme templates with the new pitstops + checklists
 * provided in Creche-PitStops-Checklist.xlsx (sheets "New Creche" and "Existing Creche").
 * Activity titles + completion types are chosen item-by-item.
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/seed-creche-templates.ts
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "", max: 1 });
const prisma = new PrismaClient({ adapter });

type CompletionType = "Activity" | "Voice" | "Upload";
type ChecklistItem = {
  key: string;
  text: string;
  activities: { title: string; completionType: CompletionType }[];
};
type Pitstop = {
  type: string;
  title: string;
  notes?: string;
  slaDays: number;
  startSlaDays: number;
  progressTag: string;
  checklist: ChecklistItem[];
  recurrence?: "None" | "Weekly" | "Monthly" | "Quarterly";
  repeatCount?: number;
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

const item = (text: string, activityTitle: string, completionType: CompletionType): ChecklistItem => ({
  key: slug(text),
  text,
  activities: [{ title: activityTitle, completionType }],
});

// ── New Creche programme ──────────────────────────────────────────────────────
const newCrechePitstops: Pitstop[] = [
  {
    type: "Meeting",
    title: "Creche Approval",
    notes: "Onboard partner, scope number of creches, secure budget approval, complete Fluxx setup, and disburse first tranche.",
    slaDays: 45,
    startSlaDays: 0,
    progressTag: "Permissions",
    checklist: [
      item("Identify/Select Partner", "Partner identification meeting", "Activity"),
      item("Creche Orientation to Partner", "Partner orientation session", "Activity"),
      item("Secondary Data Collection (Children - 6month-3years)", "Children 6m–3yr data sheet", "Upload"),
      item("Arrive at the number of Creches", "Needs assessment workshop", "Activity"),
      item("Prepare Budget and Proposal", "Budget + proposal document", "Upload"),
      item("Budget Approval", "Approval minutes / letter", "Upload"),
      item("Fluxx Card Creation", "Fluxx card setup", "Activity"),
      item("Agreement / Addendum e-Signing", "Signed agreement (PDF)", "Upload"),
      item("Upload relevant documents in the Fluxx Card", "Fluxx supporting documents", "Upload"),
      item("Disburse 1st tranche", "Disbursal proof", "Upload"),
    ],
  },
  {
    type: "Training",
    title: "Team Recruitment and Induction",
    notes: "Bring on board the core program team and notify government of the programme.",
    slaDays: 60,
    startSlaDays: 45,
    progressTag: "Team",
    checklist: [
      item("Recruit program staff", "Recruitment drive", "Activity"),
      item("Conduct team induction, orientation and Exposure Visit", "Induction + exposure visit", "Activity"),
      item("Submit intimation letter to government", "Govt intimation letter", "Upload"),
    ],
  },
  {
    type: "SiteVisit",
    title: "Space Identification & Line Listing",
    notes: "Identify, validate and prepare the physical space; bring it into Shishughar.",
    slaDays: 75,
    startSlaDays: 60,
    progressTag: "Infrastructure",
    checklist: [
      item("Identify Suitable Space", "Site identification visit", "Activity"),
      item("Check Safety Indicators and List out required renovation measures", "Safety audit report", "Upload"),
      item("Renovate Space", "Renovation site visit", "Activity"),
      item("Create Creche Profile in Shishughar App", "Shishughar profile setup", "Activity"),
      item("Add Household Listing to Creche", "Household list (PDF/CSV)", "Upload"),
    ],
  },
  {
    type: "Meeting",
    title: "Community Engagement",
    notes: "Bring the community along; nominate caregiver candidates and set up CMC.",
    slaDays: 90,
    startSlaDays: 75,
    progressTag: "Baseline",
    checklist: [
      item("Schedule and conduct community meeting in each slum", "Community meeting", "Activity"),
      item("Explain creche program, benefits, and difference from Anganwadi", "Awareness session", "Activity"),
      item("Discuss caregiver roles, responsibilities, and stipend", "Caregiver discussion", "Activity"),
      item("Identify 2-3 potential caregiver candidates with community nomination", "Candidate observations", "Voice"),
      item("Explain Creche Management Committee (CMC) concept", "CMC orientation", "Activity"),
      item("Address community concerns and questions", "Q&A summary", "Voice"),
      item("Document meeting minutes/resolution and attendance", "Minutes + attendance sheet", "Upload"),
    ],
  },
  {
    type: "Discussion",
    title: "Care Giver Selection",
    notes: "Final shortlisting using the 10-point criteria + background checks.",
    slaDays: 95,
    startSlaDays: 90,
    progressTag: "Team",
    checklist: [
      item("Shortlist candidates using 10-point assessment criteria", "10-point assessment scoresheet", "Upload"),
      item("Conduct background check and collect documents", "Background check + ID documents", "Upload"),
    ],
  },
  {
    type: "Custom",
    title: "Procurement & Infrastructure Setup",
    notes: "Source equipment, materials and registers; log everything in the stock register.",
    slaDays: 97,
    startSlaDays: 95,
    progressTag: "Infrastructure",
    checklist: [
      item("Identify and approve vendors", "Vendor evaluation", "Activity"),
      item("Procure weighing scales and infantometers/stadiometers", "Procurement invoice — weighing/infantometer", "Upload"),
      item("Procure cooking equipment (pressure cookers, vessels, storage containers)", "Procurement invoice — cooking", "Upload"),
      item("Procure fire safety equipment (Fire extinguishers, fire blankets, sand buckets)", "Procurement invoice — fire safety", "Upload"),
      item("Procure first-aid boxes and stock with required supplies", "Procurement invoice — first aid", "Upload"),
      item("Procure mattresses, blankets, and mosquito nets", "Procurement invoice — bedding", "Upload"),
      item("Procure play materials and age-appropriate toys", "Procurement invoice — play materials", "Upload"),
      item("Set up LPG commercial accounts", "LPG account confirmation", "Upload"),
      item("Procure registers and collaterals for each creche", "Procurement invoice — registers/collaterals", "Upload"),
      item("Document all procurement in stock register", "Stock register snapshot", "Upload"),
    ],
  },
  {
    type: "Training",
    title: "Pre-Service Training",
    notes: "Five-day residential training; covers safety, nutrition, hygiene, operations and assessments.",
    slaDays: 103,
    startSlaDays: 97,
    progressTag: "Training",
    checklist: [
      item("Book residential training venue", "Venue confirmation", "Upload"),
      item("Arrange childcare for trainees' own children during training", "Childcare arrangement", "Activity"),
      item("Prepare sample creche setup at training venue", "Sample creche setup", "Activity"),
      item("Day 1: Exposure visit to an operational creche", "Day 1 — exposure visit", "Activity"),
      item("Day 2: Context, child needs, caregiver roles, safety protocols", "Day 2 — context + safety", "Activity"),
      item("Day 3: Food storage, water, egg handling, cooking demos, feeding practices", "Day 3 — nutrition + cooking", "Activity"),
      item("Day 4: Child care, hygiene, engagement activities, first aid demo", "Day 4 — childcare + first aid", "Activity"),
      item("Day 5: Operations, registers, fire safety demonstration", "Day 5 — operations + fire safety", "Activity"),
      item("Conduct competency assessment of all trainees", "Competency assessment report", "Upload"),
      item("Distribute training materials and registers to each caregiver", "Material handover", "Activity"),
    ],
  },
  {
    type: "SiteVisit",
    title: "Operations Launch — Child Enrollment",
    notes: "Verify facility readiness against the 24-point safety checklist, then inaugurate and enroll.",
    slaDays: 105,
    startSlaDays: 103,
    progressTag: "Live",
    checklist: [
      item("Confirm facility readiness (safety checklist — 24 points)", "24-point safety checklist", "Upload"),
      item("Conduct pre-opening community meeting and announce start date", "Pre-opening community meeting", "Activity"),
      item("Verify all Collaterals are set up and ready", "Collateral walk-through", "Voice"),
      item("Verify all Creche materials are present", "Materials walk-through", "Voice"),
      item("Verify all play materials are present", "Play materials walk-through", "Voice"),
      item("Verify drinking water facility and toilet are in-place", "Water + toilet check", "Voice"),
      item("Inaugurate Creche and Enroll children", "Inauguration + enrollment list", "Upload"),
    ],
  },
  {
    type: "Meeting",
    title: "Growth Monitoring & Health Linking Setup",
    notes: "Wire up local health workers + referral pathways before the creche goes live.",
    slaDays: 106,
    startSlaDays: 105,
    progressTag: "Monitoring",
    checklist: [
      item("Establish contact with local ANM, AWW, and ASHA workers", "Health-worker liaison meeting", "Activity"),
      item("Verify Growth Monitoring Schedule", "Growth monitoring schedule", "Upload"),
      item("Establish referral pathway to PHC/CHC/Foundation Clinic", "PHC/CHC referral pathway doc", "Upload"),
      item("Establish referral pathway to NRC", "NRC referral pathway doc", "Upload"),
      item("Brief caregivers on Category A/B/C health alert protocols", "Caregiver alert-protocol briefing", "Activity"),
    ],
  },
];

// ── Existing Creche programme (recurring monthly cycle) ───────────────────────
const REPEAT = 12; // one year of monthly cycles
const existingCrechePitstops: Pitstop[] = [
  {
    type: "SiteVisit",
    title: "Monthly Creche Rounds",
    notes: "Monthly supervisor visit covering safety, nutrition, attendance, growth and referrals.",
    slaDays: 25,
    startSlaDays: 0,
    progressTag: "Monitoring",
    recurrence: "Monthly",
    repeatCount: REPEAT,
    checklist: [
      item("Monthly Visit Conducted", "Field visit notes", "Voice"),
      item("Caregiver conduct observed in each creche", "Caregiver observations", "Voice"),
      item("Child nutrition records reviewed", "Nutrition record review", "Voice"),
      // Mark-done ("Activity") so completion routes through CompleteActivityModal
      // where the 24-point safety tick-list is required. The structured checklist
      // is the evidence (replaces the old photo upload).
      item("Hygiene and safety standards checked against 24-point checklist", "24-point safety check", "Activity"),
      item("Attendance register and child card records reviewed", "Attendance register notes", "Voice"),
      item("Growth monitoring data spot-checked (weight/height records up to date)", "Growth monitoring spot-check", "Voice"),
      item("Health referrals verified", "Referral verification notes", "Voice"),
      item("Creche visit log updated", "Visit log (signed PDF)", "Upload"),
    ],
  },
  {
    type: "Meeting",
    title: "Creche Supervisor and Caregiver Review",
    notes: "Monthly review with the supervisor + caregivers; cross-check MIS, plan pipeline, capture actions.",
    slaDays: 30,
    startSlaDays: 25,
    progressTag: "Monitoring",
    recurrence: "Monthly",
    repeatCount: REPEAT,
    checklist: [
      item("Supervisor and Caregivers meeting conducted", "Supervisor + caregiver review meeting", "Activity"),
      item("MIS data (Shishughar) cross-checked with field register data", "Shishughar vs field reconciliation", "Voice"),
      item("Expansion / new creche pipeline reviewed against needs gap", "Pipeline vs needs gap review", "Voice"),
      item("Action items documented and shared", "Action items list (PDF)", "Upload"),
    ],
  },
];

async function main() {
  await prisma.$executeRaw`
    UPDATE "GoalTemplateDef"
    SET pitstops = ${JSON.stringify(newCrechePitstops)}::jsonb, "updatedAt" = NOW()
    WHERE slug = 'creche-program'
  `;
  await prisma.$executeRaw`
    UPDATE "GoalTemplateDef"
    SET pitstops = ${JSON.stringify(existingCrechePitstops)}::jsonb, "updatedAt" = NOW()
    WHERE slug = 'creche-program-existing'
  `;
  console.log("Updated creche-program (New Creche):", newCrechePitstops.length, "pitstops,",
    newCrechePitstops.reduce((s, p) => s + p.checklist.length, 0), "checklist items");
  console.log("Updated creche-program-existing:", existingCrechePitstops.length, "pitstops × 12 monthly cycles,",
    existingCrechePitstops.reduce((s, p) => s + p.checklist.length, 0), "checklist items per cycle");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

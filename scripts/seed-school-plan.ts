// Idempotent seed for the After-School Centres portal.
//   - registers the "AfterSchoolCentre" domain in BudgetDomainConfig
//   - seeds CostRegistry items (~14) with the standard annexure figures
//   - creates the 5 pilot SchoolPlan rows (Yelahanka carrying its as-built survey
//     data), attaches an empty Budget to each, instantiates the 16-step template,
//     seeds default services/programme components
//   - seeds Yelahanka's known survey-gap risks
//
// Run: `npx tsx scripts/seed-school-plan.ts`

import prisma from "@/lib/prisma";
import { PILOT_SCHOOLS } from "@/lib/schoolPlan/stepTemplate";
import { bootstrapSchoolPlan } from "@/lib/schoolPlan/instantiate";
import { STANDARD_ALL } from "@/lib/schoolPlan/standards";

const CITY = "Bangalore";
const DOMAIN_KEY = "AfterSchoolCentre";

async function upsertDomain() {
  const existing = await prisma.budgetDomainConfig.findUnique({
    where: { city_key: { city: CITY, key: DOMAIN_KEY } },
  });
  if (existing) {
    await prisma.budgetDomainConfig.update({
      where: { id: existing.id },
      data: {
        label: "After-School Centre",
        description: "One plan per school (Moulana Azad Model Schools, Directorate of Minorities pilot).",
        beneficiaryLabel: "Children per day",
        beneficiaryVar: "targetChildrenPerDay",
        beneficiaryMult: 1,
        position: 20,
        isActive: true,
      },
    });
    return existing.id;
  }
  const row = await prisma.budgetDomainConfig.create({
    data: {
      city: CITY,
      key: DOMAIN_KEY,
      label: "After-School Centre",
      description: "One plan per school (Moulana Azad Model Schools, Directorate of Minorities pilot).",
      beneficiaryLabel: "Children per day",
      beneficiaryVar: "targetChildrenPerDay",
      beneficiaryMult: 1,
      position: 20,
      isActive: true,
    },
  });
  return row.id;
}

async function upsertCostRegistry() {
  // CostRegistry.itemKey is unique per city (see @@unique([city, itemKey])).
  for (const line of STANDARD_ALL) {
    await prisma.costRegistry.upsert({
      where: { city_itemKey: { city: CITY, itemKey: line.itemKey } },
      update: {
        unitCost: line.unitCost,
        unit: line.unit,
        domain: DOMAIN_KEY,
        notes: line.notes ?? null,
      },
      create: {
        city: CITY,
        itemKey: line.itemKey,
        unitCost: line.unitCost,
        unit: line.unit,
        domain: DOMAIN_KEY,
        notes: line.notes ?? null,
      },
    });
  }
}

async function upsertPlan(name: string, officialName: string, extras: Record<string, unknown>) {
  const existing = await prisma.schoolPlan.findFirst({
    where: { name, officialName },
    select: { id: true, budgetId: true },
  });
  if (existing) return existing;
  const row = await prisma.schoolPlan.create({
    data: { name, officialName, ...extras },
    select: { id: true, budgetId: true },
  });
  return row;
}

async function ensureBudget(planId: string, planName: string) {
  const plan = await prisma.schoolPlan.findUnique({
    where: { id: planId },
    select: { budgetId: true, ourLeadUserId: true, targetChildrenPerDay: true },
  });

  // Whatever inputs a fresh regenerate needs to reconcile to the annexure.
  const extraInputs = {
    nAfterSchoolCentres: 1,
    targetChildrenPerDay: plan?.targetChildrenPerDay ?? 300,
    ascCentreRentPerMonth: 0,
  };

  if (plan?.budgetId) {
    // Existing budget — make sure BudgetInputs carries the extraInputs so a
    // Regenerate on the budget editor produces the standard.
    await prisma.budgetInputs.upsert({
      where: { budgetId: plan.budgetId },
      create: { budgetId: plan.budgetId, extraInputs },
      update: { extraInputs },
    });
    return plan.budgetId;
  }

  // Attribute the auto-created Budget to the plan's lead or, failing that, the
  // Pitstops super-admin (there always is one). Budget.partnerId is required.
  const owner = plan?.ourLeadUserId
    ? { id: plan.ourLeadUserId }
    : await prisma.user.findFirst({
        where: { isOwner: true },
        select: { id: true },
      });
  if (!owner) {
    throw new Error("No isOwner=true user found; assign an ourLead before seeding.");
  }

  const budget = await prisma.budget.create({
    data: {
      name: `${planName} — After-School Centre`,
      partnerId: owner.id,
      city: CITY,
      domains: [DOMAIN_KEY],
      years: 5,
      horizonMonths: 60,
      applyInflation: true,
      inflationSalaryPct: 10,
      inflationOtherPct: 5,
      inflationNilPct: 0,
      status: "draft",
      inputs: { create: { extraInputs } },
    },
    select: { id: true },
  });
  await prisma.schoolPlan.update({
    where: { id: planId },
    data: { budgetId: budget.id },
  });
  return budget.id;
}

async function seedYelahankaExtras(planId: string) {
  // Site + built-up + survey status per brief §9.
  await prisma.schoolPlan.update({
    where: { id: planId },
    data: {
      siteAreaSqft: 5680,
      builtupAreaSqft: 5754,  // Model School block G+2+terrace total
      surveyStatus: "in_progress",
      addressText: "Chowdeshwari Layout, Yelahanka Old Town, Bengaluru 560064",
      ward: "Yelahanka Old Town",
    },
  });

  // Space rows from the as-built survey (Model School block + Urdu building + courtyard).
  const spaces = [
    { building: "Model School block", floor: "G",       name: "Ground floor (3 classrooms)",  sizeSqm: 133.01, currentUse: "Classrooms", proposedUse: "Programme rooms", sortOrder: 0 },
    { building: "Model School block", floor: "1",       name: "First floor (3 classrooms)",   sizeSqm: 134.30, currentUse: "Classrooms", proposedUse: "Programme rooms", sortOrder: 1 },
    { building: "Model School block", floor: "2",       name: "Second floor (3 classrooms)",  sizeSqm: 133.67, currentUse: "Classrooms", proposedUse: "Programme rooms", sortOrder: 2 },
    { building: "Model School block", floor: "Terrace", name: "Terrace store + sheet-roof",   sizeSqm: 133.54, currentUse: "Storage",    proposedUse: "Multipurpose",    structuralFlags: "sheet-roof, ISMB framing", sortOrder: 3 },
    { building: "Urdu building",       floor: "1",      name: "Open terrace",                 sizeSqm: 241.01, currentUse: "Unused",     proposedUse: "Youth programmes", structuralFlags: "parapet_below_1.2m", sortOrder: 4 },
    { building: "Courtyard",           floor: null,     name: "Central courtyard",            sizeSqm: 123.00, currentUse: "Assembly",   proposedUse: "Sports / assembly", sortOrder: 5 },
  ];
  for (const s of spaces) {
    const already = await prisma.schoolPlanSpace.findFirst({ where: { planId, name: s.name }, select: { id: true } });
    if (already) continue;
    await prisma.schoolPlanSpace.create({ data: { planId, ...s } });
  }

  // Structural + services risks called out in the brief.
  const risks = [
    { description: "Urdu building parapet <1.2 m — child-safe threshold not met",   mitigation: "Raise to ≥1.2 m or add railing/mesh at refurbishment",             status: "open", sortOrder: 0 },
    { description: "Structural assessment of both terraces pending",                mitigation: "Commission load test before Youth programmes on terrace",           status: "open", sortOrder: 1 },
    { description: "Services survey (water/electrical/sewage/drain) pending",       mitigation: "Include in architect brief; capture in §4 checklist",              status: "open", sortOrder: 2 },
    { description: "Toilet fixture count pending",                                   mitigation: "Verify in services survey",                                        status: "open", sortOrder: 3 },
    { description: "Site-area cross-check vs department records pending",           mitigation: "Reconcile with Directorate before design finalised",                status: "open", sortOrder: 4 },
    { description: "Step-free access (plinth ~0.6–0.7 m above courtyard)",          mitigation: "Ramp design at architect stage",                                  status: "open", sortOrder: 5 },
    // Capex standard locked at ₹87 L (annexure). The ₹88.2 L in the GC note's
    // summary table has been accepted as a note-side rounding, not a real gap.
  ];
  for (const r of risks) {
    const already = await prisma.schoolPlanRisk.findFirst({ where: { planId, description: r.description }, select: { id: true } });
    if (already) continue;
    await prisma.schoolPlanRisk.create({ data: { planId, ...r } });
  }
}

async function main() {
  console.log("[seed-school-plan] domain + registry…");
  await upsertDomain();
  await upsertCostRegistry();

  console.log("[seed-school-plan] pilot plans…");
  for (const p of PILOT_SCHOOLS) {
    const row = await upsertPlan(p.name, p.officialName, {
      taluk: p.taluk,
      district: p.district,
      targetChildrenPerDay: p.targetChildrenPerDay,
      // DJ Halli — Directorate hasn't built the school yet; interim structure
      // takes the place of the as-built survey. See GC status note §B.6.
      ...(p.name === "DJ Halli" ? {
        isInterimStructure: true,
        interimStructureSpec: "Temporary structure to be built by us until the Directorate constructs the school building. Approved at GC (§B.6). Programme runs to standard curriculum + staffing; §3 space inventory replaced by this spec once the structure is designed.",
      } : {}),
    });
    await ensureBudget(row.id, p.name);
    const counts = await bootstrapSchoolPlan(row.id);
    console.log(
      `  ${p.name}: ${counts.categoriesAdded} categories, ${counts.stepsAdded} steps, ${counts.servicesAdded} services, ${counts.componentsAdded} components`,
    );
    if (p.name === "Yelahanka") await seedYelahankaExtras(row.id);
    if (p.name === "DJ Halli") {
      // upsertPlan short-circuits on existing rows — set interim fields even
      // when we're re-running against an already-seeded database.
      await prisma.schoolPlan.update({
        where: { id: row.id },
        data: {
          isInterimStructure: true,
          interimStructureSpec: "Temporary structure to be built by us until the Directorate constructs the school building. Approved at GC (§B.6). Programme runs to standard curriculum + staffing; §3 space inventory replaced by this spec once the structure is designed.",
        },
      });
    }
  }

  console.log("[seed-school-plan] done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

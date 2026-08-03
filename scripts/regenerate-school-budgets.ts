// One-shot: regenerate each SchoolPlan's Budget lines from its current inputs +
// the live CostRegistry + LineTemplate for the budget's city.
//
// Motivation: f8f0032 added AfterSchoolCentre LineTemplates + registry items but
// the 5 school budgets already existed with old (pre-domain-seed) lines. There
// is no user-facing Regenerate button in the editor. This script mirrors what
// createBudget in app/(budget)/budget/actions.ts does at create-time — for
// existing budgets — so the lines catch up to the current templates.
//
// Safety:
//  - Skips budgets with importedAt set (hand-authored via Excel import).
//  - Skips budgets shared with the grantee or already edited by them
//    (partnerEditState / partnerEditedAt) — regenerating would erase their work.
//  - Skips + warns if any BudgetReport / BudgetReportLine / BudgetReallocationRequest
//    exists — regenerating would cascade-delete those rows.
//  - `--dry-run` prints per-budget plan + section totals without writing.
//  - `--plan=<name>` targets a single SchoolPlan by name (case-insensitive).
//
// Run:
//   npx tsx scripts/regenerate-school-budgets.ts --dry-run
//   npx tsx scripts/regenerate-school-budgets.ts --plan=Yelahanka
//   npx tsx scripts/regenerate-school-budgets.ts               # all 5, live
import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateBudgetLines, DEFAULT_INFLATION_RATES, activeYearBands } from "../lib/budget-generator";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const planFilter = args.find(a => a.startsWith("--plan="))?.slice("--plan=".length)?.toLowerCase();

const lakh = (r: number) => `₹${(r / 1_00_000).toFixed(2)} L`;

async function main() {
  // Snap a super-admin id to attribute the cost-history rows to (mirrors
  // snapshotLineWorking in budget/actions.ts). Falls back to the plan's lead.
  const superAdmin = await prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } });

  const plans = await prisma.schoolPlan.findMany({
    where: { budgetId: { not: null } },
    select: { id: true, name: true, budgetId: true, ourLeadUserId: true },
    orderBy: { name: "asc" },
  });
  const targets = planFilter ? plans.filter(p => p.name.toLowerCase() === planFilter) : plans;
  if (targets.length === 0) {
    console.log(planFilter ? `No SchoolPlan named "${planFilter}" with a linked budget.` : "No SchoolPlans have linked budgets.");
    await prisma.$disconnect();
    return;
  }

  console.log(`${DRY ? "[DRY RUN] " : ""}Regenerating ${targets.length} school budget${targets.length === 1 ? "" : "s"}${planFilter ? ` (${planFilter})` : ""}\n`);

  let ok = 0, skipped = 0;
  for (const plan of targets) {
    const budget = await prisma.budget.findUnique({
      where: { id: plan.budgetId! },
      include: { inputs: true },
    });
    if (!budget) { console.log(`- ${plan.name}: budget ${plan.budgetId} missing, skip.`); skipped++; continue; }

    // Guardrails ------------------------------------------------------------
    if (budget.importedAt) {
      console.log(`- ${plan.name}: importedAt=${budget.importedAt.toISOString()} (hand-authored). Skip.`);
      skipped++; continue;
    }
    if (budget.partnerEditedAt) {
      console.log(`- ${plan.name}: partnerEditedAt=${budget.partnerEditedAt.toISOString()} (grantee edited this draft). Skip.`);
      skipped++; continue;
    }
    if (budget.partnerEditState !== "closed") {
      console.log(`- ${plan.name}: shared with the grantee (partnerEditState=${budget.partnerEditState}). Skip.`);
      skipped++; continue;
    }
    if (budget.isMultiPartner) {
      console.log(`- ${plan.name}: multi-partner budget — not supported by this script. Skip.`);
      skipped++; continue;
    }
    const [reportCount, reallocCount] = await Promise.all([
      prisma.budgetReport.count({ where: { budgetId: budget.id } }),
      prisma.budgetReallocationRequest.count({ where: { fromLine: { budgetId: budget.id } } }),
    ]);
    if (reportCount > 0 || reallocCount > 0) {
      console.log(`- ${plan.name}: has ${reportCount} report(s) + ${reallocCount} reallocation(s). Regenerating would cascade-delete them. Skip.`);
      skipped++; continue;
    }

    // Load city templates + registry (Others → Bangalore, same as createBudget) --
    const sourceCity = budget.city === "Others" ? "Bangalore" : budget.city;
    const [registryRows, templates] = await Promise.all([
      prisma.costRegistry.findMany({ where: { city: sourceCity } }),
      prisma.lineTemplate.findMany({ where: { city: sourceCity }, orderBy: { position: "asc" } }),
    ]);
    // Fresh snapshot of the live registry — the WHOLE point of regenerate is
    // to pick up the new asc.* items. costOverrides (if any) still win.
    const costSnapshot: Record<string, number> = Object.fromEntries(registryRows.map(r => [r.itemKey, r.unitCost]));
    const rawOverrides = (budget.costOverrides ?? {}) as Record<string, number>;
    const costOverrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawOverrides)) {
      if (typeof v === "number" && Number.isFinite(v) && k in costSnapshot) costOverrides[k] = v;
    }
    const mergedRegistry = { ...costSnapshot, ...costOverrides };

    // Inputs: typed columns + extraInputs. Match createBudget's shape.
    const bi = budget.inputs;
    const extra = (bi?.extraInputs ?? {}) as Record<string, number>;
    const inp: Record<string, number> = {
      nSettlements:              bi?.nSettlements ?? 0,
      nClusters:                 bi?.nClusters ?? 0,
      nCLCs:                     bi?.nCLCs ?? 0,
      clcRentPerMonth:           bi?.clcRentPerMonth ?? 0,
      nYRCs:                     bi?.nYRCs ?? 0,
      yrcRentPerMonth:           bi?.yrcRentPerMonth ?? 0,
      nElderlyCentres:           bi?.nElderlyCentres ?? 0,
      nElderly:                  bi?.nElderly ?? 0,
      elderlyCentreRentPerMonth: bi?.elderlyCentreRentPerMonth ?? 0,
      cosPerCluster:             bi?.cosPerCluster ?? 0,
      rcRentPerMonth:            bi?.rcRentPerMonth ?? 0,
      nCreches:                  bi?.nCreches ?? 0,
      crecheRentPerMonth:        bi?.crecheRentPerMonth ?? 0,
      ...extra,
    };

    const opts = {
      horizonMonths: budget.horizonMonths,
      applyInflation: budget.applyInflation,
      inflationRates: DEFAULT_INFLATION_RATES, // schema defaults; matches createBudget
      partialPosition: (budget.partialPosition === "start" ? "start" : "end") as "start" | "end",
    };

    const includeCrossCutting = true; // createBudget's flag isn't persisted on Budget; safe default.
    const eligibleTemplates = includeCrossCutting ? templates : templates.filter(t => t.domain !== null);
    const lines = generateBudgetLines(budget.domains, inp as never, opts, mergedRegistry, eligibleTemplates as never);

    // Reconciliation preview.
    const bySection: Record<string, number> = {};
    for (const l of lines) bySection[l.section] = (bySection[l.section] ?? 0) + (l.y1Total ?? 0);
    const total = Object.values(bySection).reduce((a, b) => a + b, 0);
    console.log(`- ${plan.name}  city=${budget.city}  domains=[${budget.domains.join(",")}]  inputs.extra=${JSON.stringify(extra)}`);
    for (const [s, v] of Object.entries(bySection)) console.log(`    ${s.padEnd(10)} ${lakh(v)}`);
    console.log(`    TOTAL      ${lakh(total)}   (${lines.length} lines)`);

    if (DRY) { ok++; continue; }

    // Write path ------------------------------------------------------------
    const changedById = plan.ourLeadUserId ?? superAdmin?.id;
    if (!changedById) {
      console.log(`    ! no super-admin + no plan lead — skip.`);
      skipped++; continue;
    }
    const years = activeYearBands(budget.horizonMonths);

    await prisma.$transaction(async (tx) => {
      // Cascade deletes BudgetLineComponent + BudgetLineCostHistory (both onDelete:Cascade).
      await tx.budgetLine.deleteMany({ where: { budgetId: budget.id } });

      if (lines.length) {
        await tx.budgetLine.createMany({
          data: lines.map(l => ({
            budgetId: budget.id,
            domain: l.domain ?? undefined,
            section: l.section,
            position: l.position,
            description: l.description,
            costCategory: l.costCategory,
            unitType: l.unitType,
            isAutoGenerated: l.isAutoGenerated ?? true,
            salaryHint: l.salaryHint,
            notes: l.notes,
            templateKey: l.templateKey,
            cadence: l.cadence,
            plannedMonths: l.plannedMonths,
            y1Units: l.y1Units, y1UnitCost: l.y1UnitCost, y1AllocPct: l.y1AllocPct, y1Total: l.y1Total,
            y2Units: l.y2Units, y2UnitCost: l.y2UnitCost, y2AllocPct: l.y2AllocPct, y2Total: l.y2Total,
            y3Units: l.y3Units, y3UnitCost: l.y3UnitCost, y3AllocPct: l.y3AllocPct, y3Total: l.y3Total,
            y4Units: l.y4Units, y4UnitCost: l.y4UnitCost, y4AllocPct: l.y4AllocPct, y4Total: l.y4Total,
            y5Units: l.y5Units, y5UnitCost: l.y5UnitCost, y5AllocPct: l.y5AllocPct, y5Total: l.y5Total,
          })),
        });
      }

      // Refresh snapshot + years so downstream code + "regenerate again" sees
      // the current registry as the basis.
      await tx.budget.update({
        where: { id: budget.id },
        data: { costSnapshot, costOverrides, years },
      });

      // Snapshot per-line working (mirrors snapshotLineWorking in actions.ts).
      const [comps, regItems, freshLines] = await Promise.all([
        tx.costRegistryComponent.findMany({ where: { city: sourceCity }, orderBy: { position: "asc" }, select: { parentItemKey: true, label: true, spec: true, qty: true, unitCost: true } }),
        tx.costRegistry.findMany({ where: { city: sourceCity }, select: { itemKey: true, derivation: true } }),
        tx.budgetLine.findMany({ where: { budgetId: budget.id }, select: { id: true, templateKey: true, y1UnitCost: true } }),
      ]);
      const compByKey = new Map<string, typeof comps>();
      for (const c of comps) { const a = compByKey.get(c.parentItemKey) ?? []; a.push(c); compByKey.set(c.parentItemKey, a); }
      const derivByKey = new Map(regItems.map(r => [r.itemKey, r.derivation]));
      const costKeyByTemplate = new Map(templates.map(t => [t.templateKey, t.costKey]));

      const componentRows: { budgetLineId: string; position: number; label: string; spec: string | null; qty: number; unitCost: number }[] = [];
      const historyRows: { budgetLineId: string; oldCost: null; newCost: number; source: string; changedById: string }[] = [];
      const derivUpdates: { id: string; derivation: string }[] = [];

      for (const l of freshLines) {
        if (l.y1UnitCost > 0) historyRows.push({ budgetLineId: l.id, oldCost: null, newCost: l.y1UnitCost, source: "regenerated", changedById });
        const costKey = l.templateKey ? costKeyByTemplate.get(l.templateKey) ?? null : null;
        if (!costKey) continue;
        const cs = compByKey.get(costKey);
        if (!cs || cs.length === 0) continue;
        cs.forEach((c, i) => componentRows.push({ budgetLineId: l.id, position: i, label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost }));
        const d = derivByKey.get(costKey);
        if (d) derivUpdates.push({ id: l.id, derivation: d });
      }

      if (componentRows.length) await tx.budgetLineComponent.createMany({ data: componentRows });
      if (historyRows.length) await tx.budgetLineCostHistory.createMany({ data: historyRows });
      for (const u of derivUpdates) await tx.budgetLine.update({ where: { id: u.id }, data: { derivation: u.derivation } });
    });

    console.log(`    ✓ regenerated (${lines.length} lines).`);
    ok++;
  }

  console.log(`\n${DRY ? "[DRY RUN] " : ""}Done. ok=${ok} skipped=${skipped} total=${targets.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

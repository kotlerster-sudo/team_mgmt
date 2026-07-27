// One-shot: regenerate every Budget that includes the Sanitation_Complex domain
// against the current parametric templates (formula-driven) + CostRegistry.
//
// Motivation: the sanitation LineTemplates now use `formula` on capex + gated
// opex lines, referencing per-unit rates in CostRegistry that were added in
// the same PR. Existing sanitation budgets still hold snapshotted lines from
// the old flat aggregate. Running this reads Budget.inputs (typed columns +
// extraInputs.wcSeats/bathCubicles/…) and rebuilds every line from the new
// formulas — matching a fresh /budget/new build.
//
// Safety:
//  - Skips budgets with importedAt set (hand-authored via Excel import).
//  - Skips + warns if any BudgetReport / BudgetReportLine / BudgetReallocationRequest
//    exists — regenerating would cascade-delete those rows.
//  - Skips multi-partner budgets (out of scope for this pass).
//  - `--dry-run` prints per-budget plan + section totals without writing.
//  - `--name=<substring>` targets by budget-name case-insensitive match.
//
// Run:
//   npx tsx scripts/regenerate-sanitation-budgets.ts --dry-run
//   npx tsx scripts/regenerate-sanitation-budgets.ts --name=Peenya
//   npx tsx scripts/regenerate-sanitation-budgets.ts               # all live
import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateBudgetLines, DEFAULT_INFLATION_RATES, activeYearBands } from "../lib/budget-generator";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const nameFilter = args.find(a => a.startsWith("--name="))?.slice("--name=".length)?.toLowerCase();

const lakh = (r: number) => `₹${(r / 1_00_000).toFixed(2)} L`;

async function main() {
  const superAdmin = await prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } });

  const budgets = await prisma.budget.findMany({
    where: { domains: { has: "Sanitation_Complex" } },
    orderBy: { name: "asc" },
    include: { inputs: true },
  });
  const targets = nameFilter ? budgets.filter(b => b.name.toLowerCase().includes(nameFilter)) : budgets;
  if (targets.length === 0) {
    console.log(nameFilter ? `No sanitation budgets match "${nameFilter}".` : "No Sanitation_Complex budgets found.");
    await prisma.$disconnect();
    return;
  }

  console.log(`${DRY ? "[DRY RUN] " : ""}Regenerating ${targets.length} sanitation budget${targets.length === 1 ? "" : "s"}${nameFilter ? ` (name~${nameFilter})` : ""}\n`);

  let ok = 0, skipped = 0;
  for (const budget of targets) {
    if (budget.importedAt) {
      console.log(`- ${budget.name}: importedAt=${budget.importedAt.toISOString()} (hand-authored). Skip.`);
      skipped++; continue;
    }
    if (budget.isMultiPartner) {
      console.log(`- ${budget.name}: multi-partner budget — not supported by this script. Skip.`);
      skipped++; continue;
    }
    const [reportCount, reallocCount] = await Promise.all([
      prisma.budgetReport.count({ where: { budgetId: budget.id } }),
      prisma.budgetReallocationRequest.count({ where: { fromLine: { budgetId: budget.id } } }),
    ]);
    if (reportCount > 0 || reallocCount > 0) {
      console.log(`- ${budget.name}: has ${reportCount} report(s) + ${reallocCount} reallocation(s). Regenerating would cascade-delete them. Skip.`);
      skipped++; continue;
    }

    const sourceCity = budget.city === "Others" ? "Bangalore" : budget.city;
    const [registryRows, templates] = await Promise.all([
      prisma.costRegistry.findMany({ where: { city: sourceCity } }),
      prisma.lineTemplate.findMany({ where: { city: sourceCity }, orderBy: { position: "asc" } }),
    ]);
    const costSnapshot: Record<string, number> = Object.fromEntries(registryRows.map(r => [r.itemKey, r.unitCost]));
    const rawOverrides = (budget.costOverrides ?? {}) as Record<string, number>;
    const costOverrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawOverrides)) {
      if (typeof v === "number" && Number.isFinite(v) && k in costSnapshot) costOverrides[k] = v;
    }
    const mergedRegistry = { ...costSnapshot, ...costOverrides };

    // Merge typed columns + extraInputs. Capacity keys (wcSeats etc) come
    // from extraInputs since they're not typed columns on BudgetInputs.
    const bi = budget.inputs;
    const extra = (bi?.extraInputs ?? {}) as Record<string, number>;
    const inp: Record<string, number> = {
      nSettlements:                    bi?.nSettlements ?? 0,
      nClusters:                       bi?.nClusters ?? 0,
      nCLCs:                           bi?.nCLCs ?? 0,
      clcRentPerMonth:                 bi?.clcRentPerMonth ?? 0,
      nYRCs:                           bi?.nYRCs ?? 0,
      yrcRentPerMonth:                 bi?.yrcRentPerMonth ?? 0,
      nElderlyCentres:                 bi?.nElderlyCentres ?? 0,
      nElderly:                        bi?.nElderly ?? 0,
      elderlyCentreRentPerMonth:       bi?.elderlyCentreRentPerMonth ?? 0,
      cosPerCluster:                   bi?.cosPerCluster ?? 0,
      rcRentPerMonth:                  bi?.rcRentPerMonth ?? 0,
      nCreches:                        bi?.nCreches ?? 0,
      crecheRentPerMonth:              bi?.crecheRentPerMonth ?? 0,
      ...extra,
    };
    // Backward-compat: for older sanitation budgets predating the parametric
    // rewrite, extraInputs won't have capacity keys. Fall back to sensible
    // Excel-default figures so regeneration still produces a coherent budget.
    // (The user can then edit the budget's inputs + regenerate again.)
    const defaults = {
      wcSeats: 30, bathCubicles: 8, washingMachines: 4, roLph: 1000, stpKld: 12,
      solarKwp: 5, tankStorageLitres: 33000, areaSqmOverride: 0,
      structureIsSingle: 0, structureIsG1: 0, structureIsG2: 1,
    };
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in inp) || typeof inp[k] !== "number") inp[k] = v;
    }

    const opts = {
      horizonMonths: budget.horizonMonths,
      applyInflation: budget.applyInflation,
      inflationRates: DEFAULT_INFLATION_RATES,
      partialPosition: (budget.partialPosition === "start" ? "start" : "end") as "start" | "end",
    };

    const includeCrossCutting = true;
    const eligibleTemplates = includeCrossCutting ? templates : templates.filter(t => t.domain !== null);
    const lines = generateBudgetLines(budget.domains, inp as never, opts, mergedRegistry, eligibleTemplates as never);

    const bySection: Record<string, number> = {};
    for (const l of lines) bySection[l.section] = (bySection[l.section] ?? 0) + (l.y1Total ?? 0);
    const total = Object.values(bySection).reduce((a, b) => a + b, 0);
    console.log(`- ${budget.name}  city=${budget.city}  domains=[${budget.domains.join(",")}]`);
    console.log(`    capacity: wcSeats=${inp.wcSeats}, bath=${inp.bathCubicles}, laundry=${inp.washingMachines}, ro=${inp.roLph}, stp=${inp.stpKld}`);
    for (const [s, v] of Object.entries(bySection)) console.log(`    ${s.padEnd(10)} ${lakh(v)}`);
    console.log(`    TOTAL      ${lakh(total)}   (${lines.length} lines)`);

    if (DRY) { ok++; continue; }

    const changedById = superAdmin?.id;
    if (!changedById) {
      console.log(`    ! no super-admin — skip.`);
      skipped++; continue;
    }
    const years = activeYearBands(budget.horizonMonths);

    await prisma.$transaction(async (tx) => {
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

      // Persist capacity inputs back so a subsequent regenerate is idempotent.
      await tx.budgetInputs.upsert({
        where: { budgetId: budget.id },
        create: { budgetId: budget.id, extraInputs: extra },
        update: { extraInputs: { ...extra, ...Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in extra))) } },
      });

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
      // For formula-based capex, the "primary cost key" is the corresponding
      // *_derived key on the registry — we map it back to a leaf per-unit rate
      // via the templateKey → derived mapping so working shows real components.
      // For simplicity: skip working snapshot for formula lines; users can
      // still expand the registry keys directly in /admin. Aggregate line
      // working is deferred to a follow-up.
      const costKeyByTemplate = new Map(templates.map(t => [t.templateKey, t.formula ? null : t.costKey]));

      const componentRows: { budgetLineId: string; position: number; label: string; spec: string | null; qty: number; unitCost: number }[] = [];
      const historyRows: { budgetLineId: string; oldCost: null; newCost: number; source: string; changedById: string }[] = [];
      const derivUpdates: { id: string; derivation: string }[] = [];

      for (const l of freshLines) {
        if (l.y1UnitCost > 0) historyRows.push({ budgetLineId: l.id, oldCost: null, newCost: l.y1UnitCost, source: "regenerated (parametric)", changedById });
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

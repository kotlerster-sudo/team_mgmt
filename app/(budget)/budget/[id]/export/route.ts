import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildBudgetWorkbook, type ExportLine } from "@/lib/budget/exportTemplate";
import { extractCostComponents, type RegistryItem, type TemplateLike } from "@/lib/budget/costDriver";
import { activeYearBands } from "@/lib/budget-generator";
import { canAccessBudget } from "@/lib/budget/budgetAccess";
import { resolveRegistryCity } from "@/lib/budget/grantingUnits";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" }, include: { components: { orderBy: { position: "asc" } } } },
      inputs: true,
      deliveryPartners: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!(await canAccessBudget(session, budget, "read"))) return new NextResponse("Not found", { status: 404 });
  if (!budget) return new NextResponse("Not found", { status: 404 });

  // Pull templates + cost registry so each programme line on the Working sheet
  // shows its cost-registry components and computes its unit cost from them.
  // A unit with no registry/templates of its own generates from its
  // registryCity, so resolve the working against the same source (matches
  // createBudget).
  const sourceCity = await resolveRegistryCity(budget.city);
  const [templates, registryRows] = await Promise.all([
    prisma.lineTemplate.findMany({
      where: { city: sourceCity },
      select: {
        templateKey: true, isSalaryStub: true, userInputCost: true,
        costKey: true, costKey2: true, costKey3: true, costMonthly: true,
        workerRatioKey: true, bufferKey: true, costPctOf: true, costPct: true,
      },
    }),
    prisma.costRegistry.findMany({
      where: { city: sourceCity },
      select: { itemKey: true, unitCost: true, unit: true },
    }),
  ]);

  const registry: RegistryItem[] = registryRows;
  const templateByKey = new Map<string, TemplateLike>();
  for (const t of templates) templateByKey.set(t.templateKey, t);

  const lines: ExportLine[] = budget.lines.map(l => {
    const tmpl = l.templateKey ? templateByKey.get(l.templateKey) : null;
    return {
      domain: l.domain,
      deliveryPartnerId: l.deliveryPartnerId,
      section: l.section,
      description: l.description,
      costCategory: l.costCategory,
      unitType: l.unitType,
      notes: l.notes,
      salaryHint: l.salaryHint,
      templateKey: l.templateKey,
      costComponents: tmpl ? extractCostComponents(tmpl, registry) : [],
      costMonthly: tmpl?.costMonthly ?? false,
      isSalaryStub: tmpl?.isSalaryStub ?? false,
      userInputCost: tmpl?.userInputCost ?? null,
      workerRatioKey: tmpl?.workerRatioKey ?? null,
      costPctOf: tmpl?.costPctOf ?? null,
      cadence: l.cadence,
      plannedMonths: l.plannedMonths,
      y1Units: l.y1Units, y1UnitCost: l.y1UnitCost, y1AllocPct: l.y1AllocPct, y1Total: l.y1Total,
      y2Units: l.y2Units, y2UnitCost: l.y2UnitCost, y2AllocPct: l.y2AllocPct, y2Total: l.y2Total,
      y3Units: l.y3Units, y3UnitCost: l.y3UnitCost, y3AllocPct: l.y3AllocPct, y3Total: l.y3Total,
      y4Units: l.y4Units, y4UnitCost: l.y4UnitCost, y4AllocPct: l.y4AllocPct, y4Total: l.y4Total,
      y5Units: l.y5Units, y5UnitCost: l.y5UnitCost, y5AllocPct: l.y5AllocPct, y5Total: l.y5Total,
    };
  });

  // Attach each line's "working" breakup, rendered inline on 04.Working: the
  // line's OWN components once authored, else the standard registry bundle
  // (via the template's costKey).
  const componentRows = await prisma.costRegistryComponent.findMany({
    where: { city: sourceCity },
    orderBy: { position: "asc" },
    select: { parentItemKey: true, label: true, spec: true, qty: true, unitCost: true },
  });
  const compByParent = new Map<string, typeof componentRows>();
  for (const c of componentRows) {
    const arr = compByParent.get(c.parentItemKey) ?? [];
    arr.push(c);
    compByParent.set(c.parentItemKey, arr);
  }
  budget.lines.forEach((l, i) => {
    if (l.components && l.components.length > 0) {
      lines[i].breakup = l.components.map(c => ({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost }));
      return;
    }
    const parentKey = l.templateKey ? templateByKey.get(l.templateKey)?.costKey ?? null : null;
    const comps = parentKey ? compByParent.get(parentKey) : null;
    if (comps && comps.length > 0) {
      lines[i].breakup = comps.map(c => ({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost }));
    }
  });

  // years here is the count of year-band columns the xlsx should expose (1..5).
  const horizonMonths = budget.horizonMonths ?? budget.years * 12;
  const years = activeYearBands(horizonMonths);

  // Flat programme-input map: prefer the full extraInputs blob (source of truth
  // going forward); fall back to the typed columns for older rows.
  const extra = (budget.inputs?.extraInputs ?? {}) as Record<string, number>;
  const inputsFlat: Record<string, number> = Object.keys(extra).length > 0
    ? extra
    : budget.inputs
      ? {
          nSettlements: budget.inputs.nSettlements, nClusters: budget.inputs.nClusters,
          nCLCs: budget.inputs.nCLCs, clcRentPerMonth: budget.inputs.clcRentPerMonth,
          nYRCs: budget.inputs.nYRCs, yrcRentPerMonth: budget.inputs.yrcRentPerMonth,
          nElderlyCentres: budget.inputs.nElderlyCentres, nElderly: budget.inputs.nElderly,
          elderlyCentreRentPerMonth: budget.inputs.elderlyCentreRentPerMonth,
          cosPerCluster: budget.inputs.cosPerCluster, rcRentPerMonth: budget.inputs.rcRentPerMonth,
          nCreches: budget.inputs.nCreches, crecheRentPerMonth: budget.inputs.crecheRentPerMonth,
        }
      : {};

  const buffer = await buildBudgetWorkbook({
    name: budget.name,
    domains: budget.domains,
    years,
    inflationRates: budget.applyInflation
      ? {
          Salary: budget.inflationSalaryPct / 100,
          Other:  budget.inflationOtherPct / 100,
          Nil:    budget.inflationNilPct / 100,
        }
      : { Salary: 0, Other: 0, Nil: 0 },
    lines,
    deliveryPartners: budget.isMultiPartner
      ? budget.deliveryPartners.map(p => ({ id: p.id, name: p.name, sharedPct: p.sharedPct }))
      : undefined,
    meta: {
      city: budget.city,
      horizonMonths,
      applyInflation: budget.applyInflation,
      inflationPct: { Salary: budget.inflationSalaryPct, Other: budget.inflationOtherPct, Nil: budget.inflationNilPct },
      inputs: inputsFlat,
      costOverrides: (budget.costOverrides ?? {}) as Record<string, number>,
      costSnapshot: (budget.costSnapshot ?? {}) as Record<string, number>,
    },
  });

  const safeName = budget.name.replace(/[^a-z0-9]/gi, "_").substring(0, 40);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_budget.xlsx"`,
    },
  });
}

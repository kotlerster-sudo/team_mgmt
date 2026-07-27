"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getDefaultsForCity } from "@/lib/budget-costs";
import { getTemplatesForCity } from "@/lib/line-template-seeds";
import { logCostChange } from "@/lib/budget/costHistory";
import type { BudgetSection, InflationType } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Author the "working" for a registry item: replace its component breakup and
 * free-text derivation. When components are present, the item's unit cost is set
 * to the rollup (Σ qty×unitCost) — a cost is the sum of its working — and the
 * change is logged. Upserts the CostRegistry row if it didn't exist yet.
 */
export async function saveCostComponents(
  city: string,
  itemKey: string,
  rows: { label: string; spec?: string | null; qty: number; unitCost: number }[],
  derivation: string | null,
  meta: { unit: string; domain?: string | null; currentCost: number },
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const clean = rows
    .map(r => ({ label: (r.label ?? "").trim(), spec: (r.spec ?? "")?.toString().trim() || null, qty: Number(r.qty) || 0, unitCost: Number(r.unitCost) || 0 }))
    .filter(r => r.label.length > 0);
  const rollup = Math.round(clean.reduce((s, r) => s + r.qty * r.unitCost, 0));
  const deriv = derivation?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.costRegistryComponent.deleteMany({ where: { city, parentItemKey: itemKey } });
    if (clean.length > 0) {
      await tx.costRegistryComponent.createMany({
        data: clean.map((r, i) => ({ city, parentItemKey: itemKey, position: i, label: r.label, spec: r.spec, qty: r.qty, unitCost: r.unitCost })),
      });
    }
    const existing = await tx.costRegistry.findUnique({ where: { city_itemKey: { city, itemKey } } });
    const oldCost = existing?.unitCost ?? null;
    // Components present → the unit cost IS the rollup. No components → leave the
    // current cost untouched (derivation-only item).
    const newCost = clean.length > 0 ? rollup : (existing?.unitCost ?? meta.currentCost);
    await tx.costRegistry.upsert({
      where: { city_itemKey: { city, itemKey } },
      create: { city, itemKey, unit: meta.unit, domain: meta.domain ?? null, unitCost: newCost, derivation: deriv },
      update: { unitCost: newCost, derivation: deriv },
    });
    if (oldCost !== newCost) {
      await logCostChange(tx, { city, domain: meta.domain ?? null, itemKey, oldCost, newCost, source: "working editor", changedById: session.user!.id });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/budget/admin");
}

/** Change history for one registry item, newest first (for the portal timeline). */
export async function getCostHistory(city: string, itemKey: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const rows = await prisma.costRegistryHistory.findMany({
    where: { city, itemKey },
    orderBy: { changedAt: "desc" },
    take: 50,
  });
  const byId = new Map(
    (await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.changedById).filter((v): v is string => !!v))] } },
      select: { id: true, name: true, email: true },
    })).map(u => [u.id, u.name ?? u.email])
  );
  return rows.map(r => ({
    id: r.id,
    oldCost: r.oldCost,
    newCost: r.newCost,
    source: r.source,
    reason: r.reason,
    changedBy: r.changedById ? (byId.get(r.changedById) ?? null) : null,
    changedAt: r.changedAt.toISOString(),
  }));
}

export async function seedCostRegistry(city = "Bangalore") {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const defaults = getDefaultsForCity(city);
  // Log creations only: seed never overwrites existing edits (update:{}), so
  // pre-compute which itemKeys are absent and log those as null → seeded value.
  const existing = await prisma.costRegistry.findMany({
    where: { city, itemKey: { in: defaults.map(c => c.itemKey) } },
    select: { itemKey: true },
  });
  const existingKeys = new Set(existing.map(e => e.itemKey));

  await prisma.$transaction(
    defaults.map(c =>
      prisma.costRegistry.upsert({
        where: { city_itemKey: { city, itemKey: c.itemKey } },
        create: {
          city,
          domain: c.domain ?? undefined,
          itemKey: c.itemKey,
          unitCost: c.unitCost,
          unit: c.unit,
          effectiveYear: 2025,
          notes: c.notes,
        },
        update: {},  // Don't overwrite edits
      })
    )
  );

  for (const c of defaults) {
    if (existingKeys.has(c.itemKey)) continue;
    await logCostChange(prisma, {
      city, domain: c.domain ?? null, itemKey: c.itemKey,
      oldCost: null, newCost: c.unitCost,
      source: "seed", changedById: session.user.id,
    });
  }

  revalidatePath("/admin");
}

export async function addCostItem(
  city: string,
  data: { domain?: string | null; itemKey: string; unit: string; unitCost: number; notes?: string; displayGroup?: string | null }
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.costRegistry.create({
    data: {
      city,
      domain: data.domain ?? null,
      itemKey: data.itemKey,
      unit: data.unit,
      unitCost: data.unitCost,
      effectiveYear: 2025,
      notes: data.notes ?? null,
      displayGroup: data.displayGroup ?? null,
    },
  });
  await logCostChange(prisma, {
    city, domain: data.domain ?? null, itemKey: data.itemKey,
    oldCost: null, newCost: data.unitCost,
    source: "admin edit", changedById: session.user.id,
  });
  revalidatePath("/admin");
}

export async function updateCostRegistry(
  id: string, unitCost: number, notes?: string,
  displayGroup?: string | null, needsDomain?: string | null
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const before = await prisma.costRegistry.findUnique({ where: { id } });
  await prisma.costRegistry.update({
    where: { id },
    data: {
      unitCost, notes,
      ...(displayGroup !== undefined ? { displayGroup } : {}),
      ...(needsDomain  !== undefined ? { needsDomain }  : {}),
    },
  });
  if (before) {
    await logCostChange(prisma, {
      city: before.city, domain: before.domain, itemKey: before.itemKey,
      oldCost: before.unitCost, newCost: unitCost,
      source: "admin edit", changedById: session.user.id,
    });
  }
  revalidatePath("/admin");
}

// Standard inp.* display groups — used for seeding and derived defaults
const STANDARD_PROG_INPUTS = [
  { itemKey: "inp.nSettlements",              unit: "count",    unitCost: 10,    notes: "No. of settlements",                    displayGroup: "geography"  },
  { itemKey: "inp.nClusters",                 unit: "count",    unitCost: 3,     notes: "No. of clusters",                       displayGroup: "geography"  },
  { itemKey: "inp.cosPerCluster",             unit: "count",    unitCost: 2,     notes: "COs per cluster",                       displayGroup: "geography"  },
  { itemKey: "inp.cosTotal",                  unit: "count",    unitCost: 0,     notes: "Total COs",                             displayGroup: "geography"  },
  { itemKey: "inp.nCLCs",                     unit: "count",    unitCost: 5,     notes: "No. of CLCs",                           displayGroup: "facilities" },
  { itemKey: "inp.clcRentPerMonth",           unit: "₹/month",  unitCost: 15000, notes: "CLC rent / mo",                         displayGroup: "facilities" },
  { itemKey: "inp.nYRCs",                     unit: "count",    unitCost: 2,     notes: "No. of YRCs",                           displayGroup: "facilities" },
  { itemKey: "inp.yrcRentPerMonth",           unit: "₹/month",  unitCost: 10000, notes: "YRC rent / mo",                         displayGroup: "facilities" },
  { itemKey: "inp.nElderlyCentres",           unit: "count",    unitCost: 2,     notes: "No. of elderly centres",                displayGroup: "facilities" },
  { itemKey: "inp.elderlyCentreRentPerMonth", unit: "₹/month",  unitCost: 8000,  notes: "Elderly centre rent / mo",              displayGroup: "facilities" },
  { itemKey: "inp.nCreches",                  unit: "count",    unitCost: 3,     notes: "No. of creches",                        displayGroup: "facilities" },
  { itemKey: "inp.crecheRentPerMonth",        unit: "₹/month",  unitCost: 12000, notes: "Creche rent / mo",                      displayGroup: "facilities" },
  { itemKey: "inp.rcRentPerMonth",            unit: "₹/month",  unitCost: 5000,  notes: "RC rent / mo",                          displayGroup: "facilities" },
  { itemKey: "inp.nElderly",                  unit: "count",    unitCost: 50,    notes: "Elderly enrolled",                      displayGroup: "coverage"   },
  // Food distribution
  { itemKey: "inp.nDPs",                      unit: "count",    unitCost: 50,    notes: "No. of distribution points",            displayGroup: "facilities" },
  { itemKey: "inp.nMealsPerDay",              unit: "count",    unitCost: 10000, notes: "Total daily meals (kitchen capacity)",  displayGroup: "coverage"   },
  { itemKey: "inp.nOperatingDaysPerYear",     unit: "days",     unitCost: 300,   notes: "Operating days/year (25 × 12)",         displayGroup: "coverage"   },
  { itemKey: "inp.nTrucks",                   unit: "count",    unitCost: 17,    notes: "No. of trucks",                         displayGroup: "facilities" },
  { itemKey: "inp.kitchenRentPerMonth",       unit: "₹/month",  unitCost: 150000, notes: "Kitchen + warehouse rent / mo",        displayGroup: "facilities" },
  // RO Water + Sanitation Complex (standalone domains)
  { itemKey: "inp.nRO_Plants",                unit: "count",    unitCost: 1,     notes: "No. of RO water plants",                displayGroup: "facilities" },
  { itemKey: "inp.roPlantRentPerMonth",       unit: "₹/month",  unitCost: 0,     notes: "RO plant site rent / mo",               displayGroup: "facilities" },
  // RO_Water — capacity mix (drives parametric formulas)
  { itemKey: "inp.roLph",                     unit: "L/hour",   unitCost: 1000,  notes: "RO plant capacity per plant",           displayGroup: "capacity"   },
  { itemKey: "inp.roTankLitres",              unit: "L",        unitCost: 4000,  notes: "Storage tanks (raw + product) per plant", displayGroup: "capacity" },
  { itemKey: "inp.roSolarKwp",                unit: "kWp",      unitCost: 2.5,   notes: "Solar PV backup per plant",             displayGroup: "capacity"   },
  { itemKey: "inp.hasBorewell",               unit: "0/1",      unitCost: 1,     notes: "1 = includes borewell + source connection; 0 = municipal supply only", displayGroup: "facilities" },
  { itemKey: "inp.nSanitationComplexes",      unit: "count",    unitCost: 1,     notes: "No. of sanitation complexes",           displayGroup: "facilities" },
  { itemKey: "inp.sanitationComplexRentPerMonth", unit: "₹/month", unitCost: 0,  notes: "Sanitation complex rent / mo",          displayGroup: "facilities" },
  // Sanitation Complex — capacity mix (drives parametric formulas)
  { itemKey: "inp.wcSeats",                   unit: "seats",    unitCost: 30,    notes: "Total WC seats (M + F + DA) per complex", displayGroup: "capacity"   },
  { itemKey: "inp.bathCubicles",              unit: "cubicles", unitCost: 8,     notes: "Bathing cubicles per complex",            displayGroup: "capacity"   },
  { itemKey: "inp.washingMachines",           unit: "machines", unitCost: 4,     notes: "Washing machines per complex (0 = no laundry)", displayGroup: "capacity" },
  { itemKey: "inp.roLph",                     unit: "L/hour",   unitCost: 1000,  notes: "RO plant capacity (0 = no drinking water)", displayGroup: "capacity" },
  { itemKey: "inp.stpKld",                    unit: "KL/day",   unitCost: 12,    notes: "Greywater treatment capacity (0 = no STP)", displayGroup: "capacity" },
  { itemKey: "inp.solarKwp",                  unit: "kWp",      unitCost: 5,     notes: "Solar PV capacity per complex",           displayGroup: "capacity"   },
  { itemKey: "inp.tankStorageLitres",         unit: "L",        unitCost: 33000, notes: "Water storage (UG + OH) per complex",     displayGroup: "capacity"   },
  { itemKey: "inp.areaSqmOverride",           unit: "sqm",      unitCost: 0,     notes: "Built-up area override (0 = auto-derive from fixtures)", displayGroup: "facilities" },
  // Structure type is enum, expanded to 3 sentinel numerics (exactly one is 1)
  { itemKey: "inp.structureIsSingle",         unit: "0/1",      unitCost: 0,     notes: "Structure = single-floor (sentinel; set via structureType picker)", displayGroup: "facilities" },
  { itemKey: "inp.structureIsG1",             unit: "0/1",      unitCost: 0,     notes: "Structure = G+1 (sentinel)",              displayGroup: "facilities" },
  { itemKey: "inp.structureIsG2",             unit: "0/1",      unitCost: 1,     notes: "Structure = G+2 (sentinel; default)",     displayGroup: "facilities" },
  // After-School Centre (standalone)
  { itemKey: "inp.nAfterSchoolCentres",       unit: "count",    unitCost: 1,     notes: "No. of after-school centres",           displayGroup: "facilities" },
  { itemKey: "inp.targetChildrenPerDay",      unit: "count",    unitCost: 300,   notes: "Children per day (drives food-cost line)", displayGroup: "coverage" },
  { itemKey: "inp.ascCentreRentPerMonth",     unit: "₹/month",  unitCost: 0,     notes: "After-school centre site rent (usually 0 — dept-owned)", displayGroup: "facilities" },
];

export async function seedProgrammeInputs(city: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  await prisma.$transaction(
    STANDARD_PROG_INPUTS.map(d =>
      prisma.costRegistry.upsert({
        where: { city_itemKey: { city, itemKey: d.itemKey } },
        create: { city, domain: null, effectiveYear: 2025, ...d },
        update: { displayGroup: d.displayGroup, notes: d.notes },
      })
    )
  );
  revalidatePath("/admin");
}

// Back-fills displayGroup AND fixes notes (removes "Typical" etc.) on existing standard items
export async function backfillDisplayGroups(city: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  await prisma.$transaction(
    STANDARD_PROG_INPUTS.map(d =>
      prisma.costRegistry.updateMany({
        where: { city, itemKey: d.itemKey },
        data: { displayGroup: d.displayGroup, notes: d.notes },
      })
    )
  );
  revalidatePath("/admin");
}

export async function deleteCostItem(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const before = await prisma.costRegistry.findUnique({ where: { id } });
  await prisma.costRegistry.delete({ where: { id } });
  if (before) {
    await logCostChange(prisma, {
      city: before.city, domain: before.domain, itemKey: before.itemKey,
      oldCost: before.unitCost, newCost: null,
      source: "admin edit", changedById: session.user.id,
    });
  }
  revalidatePath("/admin");
}

export async function resetCostRegistry(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const entry = await prisma.costRegistry.findUnique({ where: { id } });
  if (!entry) return;

  const defaults = getDefaultsForCity(entry.city);
  const def = defaults.find(c => c.itemKey === entry.itemKey);
  if (!def) return;

  await prisma.costRegistry.update({
    where: { id },
    data: { unitCost: def.unitCost, notes: def.notes },
  });
  await logCostChange(prisma, {
    city: entry.city, domain: entry.domain, itemKey: entry.itemKey,
    oldCost: entry.unitCost, newCost: def.unitCost,
    source: "reset", changedById: session.user.id,
  });
  revalidatePath("/admin");
}

// ─── Line template actions ────────────────────────────────────────────────────

export type LineTemplateFields = {
  domain?: string | null;
  section: BudgetSection;
  description: string;
  costCategory: InflationType;
  unitType: string;
  notes?: string | null;
  salaryHint?: string | null;
  isAutoGenerated?: boolean;
  inputVar: string;
  inputMonthly?: boolean;
  supervisorRatioKey?: string | null;
  inputThreshold?: number | null;
  isSalaryStub?: boolean;
  userInputCost?: string | null;
  costKey?: string | null;
  costKey2?: string | null;
  costKey3?: string | null;
  costMonthly?: boolean;
  workerRatioKey?: string | null;
  bufferKey?: string | null;
  costPctOf?: string | null;
  costPct?: number | null;
  y1UnitsZero?: boolean;
  applyY1?: boolean;
  applyY2?: boolean;
  applyY3?: boolean;
  y2UnitsScale?: number | null;
  y3UnitsScale?: number | null;
};

export async function toggleLineTemplate(id: string, isActive: boolean) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.lineTemplate.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin");
}

export async function addLineTemplate(city: string, fields: LineTemplateFields) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const maxPos = await prisma.lineTemplate.aggregate({
    where: { city },
    _max: { position: true },
  });
  const position = (maxPos._max.position ?? 0) + 1;
  const templateKey = `custom.${Date.now()}`;

  await prisma.lineTemplate.create({
    data: { city, templateKey, position, isActive: true, ...fields },
  });
  revalidatePath("/admin");
}

export async function updateLineTemplate(id: string, fields: Partial<LineTemplateFields>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.lineTemplate.update({ where: { id }, data: fields });
  revalidatePath("/admin");
}

export async function deleteLineTemplate(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.lineTemplate.delete({ where: { id } });
  revalidatePath("/admin");
}

export async function reorderLineTemplates(city: string, orderedIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.$transaction(
    orderedIds.map((id, position) => prisma.lineTemplate.update({ where: { id }, data: { position } }))
  );
  revalidatePath("/admin");
}

// ─── Domain config actions ────────────────────────────────────────────────────

export type DomainConfigFields = {
  label: string;
  description?: string | null;
  beneficiaryLabel?: string | null;
  beneficiaryVar?: string | null;
  beneficiaryMult?: number;
};

async function ensureBeneficiaryVar(city: string, varName: string) {
  const itemKey = `inp.${varName}`;
  await prisma.costRegistry.upsert({
    where: { city_itemKey: { city, itemKey } },
    create: { city, itemKey, unit: "count", unitCost: 0, effectiveYear: 2025, domain: null },
    update: {},
  });
}

export async function addDomain(city: string, key: string, fields: DomainConfigFields) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const maxPos = await prisma.budgetDomainConfig.aggregate({
    where: { city },
    _max: { position: true },
  });
  await prisma.budgetDomainConfig.create({
    data: { city, key, position: (maxPos._max.position ?? -1) + 1, ...fields },
  });
  if (fields.beneficiaryVar) await ensureBeneficiaryVar(city, fields.beneficiaryVar);
  revalidatePath("/admin");
}

export async function updateDomain(id: string, fields: Partial<DomainConfigFields>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  if (fields.beneficiaryVar) {
    const domain = await prisma.budgetDomainConfig.findUnique({ where: { id }, select: { city: true } });
    if (domain) await ensureBeneficiaryVar(domain.city, fields.beneficiaryVar);
  }
  await prisma.budgetDomainConfig.update({ where: { id }, data: fields });
  revalidatePath("/admin");
}

export async function toggleDomain(id: string, isActive: boolean) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.budgetDomainConfig.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin");
}

export async function reorderDomains(city: string, orderedIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await prisma.$transaction(
    orderedIds.map((id, position) => prisma.budgetDomainConfig.update({ where: { id }, data: { position } }))
  );
  revalidatePath("/admin");
}

export async function seedDomains(city: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const defaults = [
    { key: "Children",     label: "Children",                     description: "CLCs, after-school, camps",           position: 0, beneficiaryLabel: "Children",       beneficiaryVar: "nCLCs",        beneficiaryMult: 100 },
    { key: "Youth",        label: "Youth",                        description: "YRCs, Yuva Adda, sports",             position: 1, beneficiaryLabel: "Youth",          beneficiaryVar: "nYRCs",        beneficiaryMult: 200 },
    { key: "Elderly",      label: "Elderly + Community Kitchen",  description: "Day care, nutrition, community kitchen",position: 2, beneficiaryLabel: "Elderly",        beneficiaryVar: "nElderly",     beneficiaryMult: 1   },
    { key: "WelfareRights",label: "Welfare Rights",               description: "Entitlement & collectivization",       position: 3, beneficiaryLabel: "Households",     beneficiaryVar: "nSettlements", beneficiaryMult: 150 },
    { key: "Creche",       label: "Creche",                       description: "0–3 yr children, standard model", position: 4, beneficiaryLabel: "Creche children", beneficiaryVar: "nCreches",     beneficiaryMult: 20  },
    { key: "FoodDistribution", label: "Food Distribution",        description: "Kitchen-to-DP meal programme",         position: 5, beneficiaryLabel: "Meal",            beneficiaryVar: "nMealsPerDay", beneficiaryMult: 300 },
    { key: "RO_Water",         label: "RO Water Plant",           description: "Community RO drinking-water plant",     position: 6, beneficiaryLabel: "Households",      beneficiaryVar: "nRO_Plants",          beneficiaryMult: 500 },
    { key: "Sanitation_Complex", label: "Sanitation Complex",     description: "Toilet + bath + laundry + RO complex",  position: 7, beneficiaryLabel: "Households",      beneficiaryVar: "nSanitationComplexes", beneficiaryMult: 420 },
  ];

  await prisma.$transaction(
    defaults.map(d =>
      prisma.budgetDomainConfig.upsert({
        where: { city_key: { city, key: d.key } },
        create: { city, isActive: true, ...d },
        update: {},
      })
    )
  );
  revalidatePath("/admin");
}

// ─── Needs scenario actions ───────────────────────────────────────────────────

/** Returns child geographies for the cascading geo picker in Cost Analysis. */
export async function getGeoChildren(
  level: "city" | "zone" | "cluster",
  parentId: string
): Promise<{ id: string; name: string }[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (level === "city") {
    const cities = await prisma.city.findMany({ where: { name: parentId }, select: { id: true } });
    const ids = cities.map(c => c.id);
    return prisma.zone.findMany({
      where: ids.length > 0 ? { cityId: { in: ids }, deletedAt: null } : { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  if (level === "zone") {
    return prisma.cluster.findMany({
      where: { zoneId: parentId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  // cluster → settlements
  return prisma.settlement.findMany({
    where: { clusterId: parentId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

type PopFields = {
  totalHouseholds: number; children6m3yr: number; children4to14: number;
  youth15to21: number; elderly60plus: number;
};

function _calcNeed(pop: PopFields, rows: { domain: string; numerator: number; denominator: number | null; populationField: string | null; domainType: string; isActive: boolean }[]): Record<string, number> {
  const pm: Record<string, number> = {
    totalHouseholds: pop.totalHouseholds, children6m3yr: pop.children6m3yr,
    children4to14: pop.children4to14, youth15to21: pop.youth15to21, elderly60plus: pop.elderly60plus,
  };
  const r: Record<string, number> = {};
  for (const f of rows) {
    if (!f.isActive || f.domainType === "entitlement" || f.domainType === "boolean") continue;
    if (f.domainType === "fixed") {
      // Budget builder doesn't know cluster/zone breakdown here; report the per-scope
      // numerator when population is non-zero. Caller aggregates upstream as needed.
      const num = f.numerator > 0 ? f.numerator : 1;
      r[f.domain] = pop.totalHouseholds > 0 ? Math.floor(num) : 0;
      continue;
    }
    const pv = f.populationField ? (pm[f.populationField] ?? 0) : 0;
    const num = f.numerator > 0 ? f.numerator : 1;
    r[f.domain] = f.denominator && pv >= f.denominator ? Math.floor((pv * num) / f.denominator) : 0;
  }
  return r;
}

function _aggregatePop(assessments: PopFields[]): PopFields {
  return assessments.reduce(
    (acc, a) => ({
      totalHouseholds: acc.totalHouseholds + a.totalHouseholds,
      children6m3yr:   acc.children6m3yr   + a.children6m3yr,
      children4to14:   acc.children4to14   + a.children4to14,
      youth15to21:     acc.youth15to21     + a.youth15to21,
      elderly60plus:   acc.elderly60plus   + a.elderly60plus,
    }),
    { totalHouseholds: 0, children6m3yr: 0, children4to14: 0, youth15to21: 0, elderly60plus: 0 }
  );
}

/**
 * Loads aggregated needs values for a geography scope and maps them to inp.* keys
 * via the needsDomain field on CostRegistry. Used by Cost Analysis tab for scenarios.
 */
export async function loadNeedsScenario(
  city: string,
  level: "city" | "zone" | "cluster" | "settlement",
  geoId: string,
  metric: "need" | "addressable" | "existing" | "plan" | "gap"
): Promise<Record<string, number>> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  // ── Resolve settlement + cluster IDs in scope ──────────────────────────────
  let allSettlementIds: string[] = [];
  let allClusterIds: string[]    = [];
  let zoneId: string | null      = null;
  let clusterId: string | null   = null;
  let settlementId: string | null = null;
  let cityRecordId: string | null = null;

  if (level === "settlement") {
    settlementId = geoId;
    allSettlementIds = [geoId];
    const s = await prisma.settlement.findUnique({ where: { id: geoId }, select: { clusterId: true } });
    if (s) { allClusterIds = [s.clusterId]; clusterId = s.clusterId; }
  } else if (level === "cluster") {
    clusterId = geoId;
    const c = await prisma.cluster.findUnique({
      where: { id: geoId },
      include: { settlements: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (c) { allSettlementIds = c.settlements.map(s => s.id); allClusterIds = [geoId]; }
  } else if (level === "zone") {
    zoneId = geoId;
    const z = await prisma.zone.findUnique({
      where: { id: geoId },
      include: { clusters: { where: { deletedAt: null }, include: { settlements: { where: { deletedAt: null }, select: { id: true } } } } },
    });
    if (z) {
      allSettlementIds = z.clusters.flatMap(c => c.settlements.map(s => s.id));
      allClusterIds    = z.clusters.map(c => c.id);
    }
  } else {
    // city — match ALL City records with this name (duplicates exist in prod)
    const cityRecs = await prisma.city.findMany({ where: { name: geoId }, select: { id: true } });
    const cIds = cityRecs.map(c => c.id);
    cityRecordId = cIds[0] ?? null;
    const allZones = await prisma.zone.findMany({
      where: cIds.length > 0 ? { cityId: { in: cIds } } : { deletedAt: null },
      include: { clusters: { where: { deletedAt: null }, include: { settlements: { where: { deletedAt: null }, select: { id: true } } } } },
    });
    allSettlementIds = allZones.flatMap(z => z.clusters.flatMap(c => c.settlements.map(s => s.id)));
    allClusterIds    = allZones.flatMap(z => z.clusters.map(c => c.id));
  }

  const result: Record<string, number> = {
    nSettlements: allSettlementIds.length,
    nClusters:    allClusterIds.length,
  };

  // ── inp.* items that have needsDomain configured (exclude rent — never scenario-set) ──
  const inpItems = await prisma.costRegistry.findMany({
    where: {
      city,
      itemKey: { startsWith: "inp." },
      needsDomain: { not: null },
      NOT: { itemKey: { contains: "Rent" } },
    },
    select: { itemKey: true, needsDomain: true },
  });
  if (inpItems.length === 0) return result;

  const formulaRows = await prisma.needsFormulaConfig.findMany({ where: { isActive: true } });

  // ── Latest assessment per settlement ───────────────────────────────────────
  const assessments = await prisma.settlementAssessment.findMany({
    where: { settlementId: { in: allSettlementIds } },
    orderBy: { assessedAt: "desc" },
    distinct: ["settlementId"],
  });

  const pop = _aggregatePop(assessments);

  const domainValues: Record<string, number> = {};

  if (metric === "need") {
    const targets = _calcNeed(pop, formulaRows);
    for (const [d, v] of Object.entries(targets)) domainValues[d] = v;
  } else if (metric === "existing") {
    for (const a of assessments) {
      for (const f of formulaRows) {
        if (f.assessmentColumn) {
          domainValues[f.domain] = (domainValues[f.domain] ?? 0) + Number((a as Record<string, unknown>)[f.assessmentColumn] ?? 0);
        }
      }
    }
  } else if (metric === "addressable") {
    for (const a of assessments) {
      for (const f of formulaRows as (typeof formulaRows[0] & { addressableColumn?: string | null })[]) {
        if (f.addressableColumn) {
          const val = Number((a as Record<string, unknown>)[f.addressableColumn] ?? 0);
          if (val > 0) domainValues[f.domain] = (domainValues[f.domain] ?? 0) + val;
        }
      }
    }
  } else if (metric === "plan" || metric === "gap") {
    const goals = await prisma.goal.findMany({
      where: {
        needsDomain: { not: null },
        status: "Active",
        deletedAt: null,
        OR: [
          ...(zoneId        ? [{ needsZoneId: zoneId }]             : []),
          ...(clusterId     ? [{ needsClusterId: clusterId }]        : []),
          ...(settlementId  ? [{ needsSettlementId: settlementId }]  : []),
          ...(cityRecordId  ? [{ needsCityId: cityRecordId }]        : []),
          { needsClusterId:    { in: allClusterIds } },
          { needsSettlementId: { in: allSettlementIds } },
        ],
      },
      select: { needsDomain: true, parameter: true },
    });
    const planByDomain: Record<string, number> = {};
    for (const g of goals) {
      if (!g.needsDomain) continue;
      planByDomain[g.needsDomain] = (planByDomain[g.needsDomain] ?? 0) + (g.parameter ?? 0);
    }
    if (metric === "plan") {
      for (const [d, v] of Object.entries(planByDomain)) domainValues[d] = Math.round(v);
    } else {
      // gap = need − existing − plan
      const targets  = _calcNeed(pop, formulaRows);
      const existing: Record<string, number> = {};
      for (const a of assessments) {
        for (const f of formulaRows) {
          if (f.assessmentColumn) {
            existing[f.domain] = (existing[f.domain] ?? 0) + Number((a as Record<string, unknown>)[f.assessmentColumn] ?? 0);
          }
        }
      }
      for (const f of formulaRows) {
        if (!f.isActive || f.domainType === "entitlement") continue;
        const need   = targets[f.domain]    ?? 0;
        const ext    = existing[f.domain]   ?? 0;
        const plan   = planByDomain[f.domain] ?? 0;
        domainValues[f.domain] = Math.max(0, Math.round(need - ext - plan));
      }
    }
  }

  // ── Map domain values → inp keys ───────────────────────────────────────────
  for (const item of inpItems) {
    const key = item.itemKey.slice(4); // strip "inp."
    const val = domainValues[item.needsDomain!];
    if (val !== undefined) result[key] = val;
  }

  return result;
}

export async function seedLineTemplates(city: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const specs = getTemplatesForCity(city);
  await prisma.$transaction(
    specs.map((t, position) =>
      prisma.lineTemplate.upsert({
        where: { city_templateKey: { city, templateKey: t.templateKey } },
        update: {},  // Additive: don't overwrite existing template edits
        create: {
          city,
          templateKey:        t.templateKey,
          position,
          section:            t.section as never,
          description:        t.description,
          costCategory:       t.costCategory as never,
          unitType:           t.unitType,
          notes:              t.notes ?? null,
          salaryHint:         t.salaryHint ?? null,
          isAutoGenerated:    t.isAutoGenerated ?? true,
          domain:             (t.domain as never) ?? null,
          inputVar:           t.inputVar ?? "fixed_1",
          inputMonthly:       t.inputMonthly ?? false,
          supervisorRatioKey: t.supervisorRatioKey ?? null,
          isSalaryStub:       t.isSalaryStub ?? false,
          userInputCost:      t.userInputCost ?? null,
          costKey:            t.costKey ?? null,
          costKey2:           t.costKey2 ?? null,
          costKey3:           t.costKey3 ?? null,
          costMonthly:        t.costMonthly ?? false,
          workerRatioKey:     t.workerRatioKey ?? null,
          bufferKey:          t.bufferKey ?? null,
          costPctOf:          t.costPctOf ?? null,
          costPct:            t.costPct ?? null,
          y1UnitsZero:        t.y1UnitsZero ?? false,
          applyY2:            t.applyY2 ?? true,
          applyY3:            t.applyY3 ?? true,
        },
      })
    )
  );
  revalidatePath("/admin");
}

// ─── Cost-analysis comparison ────────────────────────────────────────────────
// Loads a budget's stored programme inputs + sparse costOverrides so the admin
// Cost Analysis tab can overlay "Your" values next to standard ones. Snapshot
// is intentionally not returned: comparison only cares about what differed
// from the live registry at create time.
export async function loadBudgetForCompare(budgetId: string): Promise<{
  name: string;
  programmeInputs: Record<string, number>;
  costOverrides: Record<string, number>;
  // Authoritative per-line totals from the saved budget. Includes user edits
  // (filled-in salary stubs, overridden unit costs, manual additions). The
  // analysis tab reads these for the Yours column instead of re-running the
  // generator, which can't reproduce salary-stub fill-ins or manual edits.
  lines: Array<{
    id: string;
    templateKey: string | null;
    domain: string | null;
    section: BudgetSection;
    description: string;
    y1Total: number;
    y2Total: number;
    y3Total: number;
    y4Total: number;
    y5Total: number;
  }>;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: {
      name: true, inputs: true, costOverrides: true,
      lines: {
        select: {
          id: true, templateKey: true, domain: true, section: true, description: true,
          y1Total: true, y2Total: true, y3Total: true, y4Total: true, y5Total: true,
        },
      },
    },
  });
  if (!budget) throw new Error("Budget not found");

  const raw = budget.inputs;
  const programmeInputs: Record<string, number> = {};
  if (raw) {
    // Typed fields first (backward compat) then extraInputs JSON wins on overlap.
    programmeInputs.nSettlements              = raw.nSettlements;
    programmeInputs.nClusters                 = raw.nClusters;
    programmeInputs.nCLCs                     = raw.nCLCs;
    programmeInputs.clcRentPerMonth           = raw.clcRentPerMonth;
    programmeInputs.nYRCs                     = raw.nYRCs;
    programmeInputs.yrcRentPerMonth           = raw.yrcRentPerMonth;
    programmeInputs.nElderlyCentres           = raw.nElderlyCentres;
    programmeInputs.nElderly                  = raw.nElderly;
    programmeInputs.elderlyCentreRentPerMonth = raw.elderlyCentreRentPerMonth;
    programmeInputs.cosPerCluster             = raw.cosPerCluster;
    programmeInputs.rcRentPerMonth            = raw.rcRentPerMonth;
    programmeInputs.nCreches                  = raw.nCreches;
    programmeInputs.crecheRentPerMonth        = raw.crecheRentPerMonth;
    Object.assign(programmeInputs, (raw.extraInputs ?? {}) as Record<string, number>);
  }

  return {
    name: budget.name,
    programmeInputs,
    costOverrides: (budget.costOverrides ?? {}) as Record<string, number>,
    lines: budget.lines,
  };
}

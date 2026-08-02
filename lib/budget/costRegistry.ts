// Scope resolution for the cost registry.
//
// Every granting unit used to hold a full copy of the registry — ~400 rows each.
// That was tolerable at three units and is not at forty: a rate that moves has
// to be edited everywhere, and drift is invisible. A unit now holds only its
// *deltas* from a shared layer.
//
// The shared layer is a reserved value of the existing `city` column rather than
// a second scope column, so `@@unique([city, itemKey])`, every index, and every
// write path keep working unchanged — a global row is just a row whose scope
// happens to be shared.
//
// It starts empty on purpose. With nothing promoted, resolution returns exactly
// what a plain `where: { city }` returned, so no existing budget can move.

import prisma from "@/lib/prisma";

export const GLOBAL_SCOPE = "Global";

export type ScopedCost = {
  id: string;
  city: string;
  domain: string | null;
  itemKey: string;
  unitCost: number;
  unit: string;
  notes: string | null;
  derivation: string | null;
  displayGroup: string | null;
  needsDomain: string | null;
  /** True when the row comes from the shared layer, not this unit. */
  inherited: boolean;
};

export type ScopedComponent = {
  parentItemKey: string;
  label: string;
  spec: string | null;
  qty: number;
  unitCost: number;
  inherited: boolean;
};

const SELECT = {
  id: true, city: true, domain: true, itemKey: true, unitCost: true, unit: true,
  notes: true, derivation: true, displayGroup: true, needsDomain: true,
} as const;

/** Global rows first, then the unit's own overwrite them key-for-key. */
export async function resolveRegistryRows(city: string): Promise<ScopedCost[]> {
  const rows = await prisma.costRegistry.findMany({
    where: { city: { in: [GLOBAL_SCOPE, city] } },
    select: SELECT,
    orderBy: [{ domain: "asc" }, { itemKey: "asc" }],
  });
  const byKey = new Map<string, ScopedCost>();
  for (const r of rows) if (r.city === city) byKey.set(r.itemKey, { ...r, inherited: false });
  for (const r of rows) {
    if (r.city === GLOBAL_SCOPE && !byKey.has(r.itemKey)) byKey.set(r.itemKey, { ...r, inherited: true });
  }
  return [...byKey.values()].sort(
    (a, b) => (a.domain ?? "").localeCompare(b.domain ?? "") || a.itemKey.localeCompare(b.itemKey),
  );
}

/** The flat itemKey → unitCost map the generator and the export both consume. */
export async function resolveRegistryMap(city: string): Promise<Record<string, number>> {
  const rows = await resolveRegistryRows(city);
  return Object.fromEntries(rows.map((r) => [r.itemKey, r.unitCost]));
}

/**
 * Component breakups ("working"), grouped by the aggregate item they derive.
 *
 * Inheritance is per parent item, not per component: a unit that authors any
 * breakup for an item replaces the shared one wholesale. Interleaving the two
 * would produce a working that no longer sums to its own total.
 */
export async function resolveRegistryComponents(city: string): Promise<Record<string, ScopedComponent[]>> {
  const comps = await prisma.costRegistryComponent.findMany({
    where: { city: { in: [GLOBAL_SCOPE, city] } },
    orderBy: { position: "asc" },
    select: { city: true, parentItemKey: true, label: true, spec: true, qty: true, unitCost: true },
  });
  const ownKeys = new Set(comps.filter((c) => c.city === city).map((c) => c.parentItemKey));
  const byKey: Record<string, ScopedComponent[]> = {};
  for (const c of comps) {
    const inherited = c.city === GLOBAL_SCOPE && city !== GLOBAL_SCOPE;
    if (inherited && ownKeys.has(c.parentItemKey)) continue;
    (byKey[c.parentItemKey] ??= []).push({
      parentItemKey: c.parentItemKey, label: c.label, spec: c.spec,
      qty: c.qty, unitCost: c.unitCost, inherited,
    });
  }
  return byKey;
}

/**
 * The shared layer on its own, so the registry UI can say what a unit row is
 * overriding. Resolution deliberately discards this — a resolved cost is a
 * single number — but provenance needs both sides.
 */
export async function globalRegistryMap(): Promise<Record<string, number>> {
  const rows = await prisma.costRegistry.findMany({
    where: { city: GLOBAL_SCOPE },
    select: { itemKey: true, unitCost: true },
  });
  return Object.fromEntries(rows.map((r) => [r.itemKey, r.unitCost]));
}

/** itemKey → derivation prose, resolved the same way. */
export async function resolveDerivations(city: string): Promise<Map<string, string | null>> {
  const rows = await resolveRegistryRows(city);
  return new Map(rows.map((r) => [r.itemKey, r.derivation]));
}

// The list of granting units — focus-geography offices, travelling thematic teams,
// operational teams — that the budget portal is organised by. Replaces the
// `["Bangalore", "Chennai", "Others"] as const` array that was copy-pasted into
// seven files, so adding a unit is an admin action rather than a deploy.
//
// `Budget.city` and `GrantPartner.city` still hold the unit *name* (the migration
// backfilled `grantingUnitId` by matching on it), so URLs like
// /budget/city/Chennai keep working and nothing needed a routing rewrite.

import { cache } from "react";
import prisma from "@/lib/prisma";

export type GrantingUnitOption = {
  id: string;
  name: string;
  kind: string;
  /** Which city's CostRegistry / LineTemplate / BudgetDomainConfig rows to generate from. */
  registryCity: string;
};

/**
 * Every unit, active or not. Lookups (`requireGrantingUnit`, `resolveRegistryCity`)
 * resolve against this: deactivating a unit must stop it appearing in pickers, not
 * strand the budgets already filed under it.
 */
const allGrantingUnits = cache(async (): Promise<(GrantingUnitOption & { isActive: boolean })[]> => {
  return prisma.grantingUnit.findMany({
    select: { id: true, name: true, kind: true, registryCity: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});

/** The units offered in pickers and tabs. */
export async function listGrantingUnits(): Promise<GrantingUnitOption[]> {
  return (await allGrantingUnits()).filter((u) => u.isActive);
}

export async function grantingUnitNames(): Promise<string[]> {
  return (await listGrantingUnits()).map((u) => u.name);
}

/** Resolve a unit by its name, for writes that must attach `grantingUnitId`. */
export async function requireGrantingUnit(name: string): Promise<GrantingUnitOption> {
  const unit = (await allGrantingUnits()).find((u) => u.name === name);
  if (!unit) throw new Error(`Unknown granting unit "${name}"`);
  if (!unit.isActive) throw new Error(`Granting unit "${name}" is deactivated.`);
  return unit;
}

/**
 * Which city's standard cost data a unit generates budgets from. This is the
 * data-driven form of the `city === "Others" ? "Bangalore"` fallback that used to
 * be repeated at every read site — a new thematic team just points its
 * `registryCity` at whichever standard set applies.
 *
 * Falls back to the argument itself for names with no unit row, which keeps
 * legacy free-text `Budget.city` values resolving the way they always did.
 */
export async function resolveRegistryCity(unitName: string): Promise<string> {
  const unit = (await allGrantingUnits()).find((u) => u.name === unitName);
  return unit?.registryCity ?? unitName;
}

/**
 * The inverse: every `Budget.city` value that generates from this registry.
 * Includes the city's own name, which covers legacy budgets filed before any
 * unit row existed.
 */
export async function unitNamesForRegistryCity(city: string): Promise<string[]> {
  const names = (await allGrantingUnits()).filter((u) => u.registryCity === city).map((u) => u.name);
  return [...new Set([city, ...names])];
}

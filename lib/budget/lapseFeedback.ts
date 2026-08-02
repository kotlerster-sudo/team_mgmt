// Real spend correcting standard costs. If the same standard line underspends
// across many grants and many partners, the registry rate behind it is probably
// too high — nothing else in the portal closes that loop.
//
// This only ever proposes. A lapse has two possible causes and the data cannot
// tell them apart: a rate that was too high, or scale that never materialised
// (eight creches opened instead of ten). An admin has to decide which, so
// applying a suggestion goes through the ordinary registry edit path.

import prisma from "@/lib/prisma";
import { resolveRegistryMap } from "@/lib/budget/costRegistry";
import { resolveRegistryCity, unitNamesForRegistryCity } from "@/lib/budget/grantingUnits";
import { templateLapse } from "@/lib/budget/lapse";

export type LapseSuggestion = {
  templateKey: string;
  itemKey: string;
  description: string;
  currentCost: number;
  suggestedCost: number;
  lapsePct: number;
  budgeted: number;
  actual: number;
  budgetCount: number;
  partnerCount: number;
};

/** Below this the lapse is noise; above it, worth an admin's attention. */
const MIN_LAPSE_PCT = 15;
/** One grant underspending is that grant's story, not the rate's. */
const MIN_BUDGETS = 2;

export async function lapseSuggestions(unitName: string): Promise<LapseSuggestion[]> {
  // Units that generate from someone else's standard set learn from spending
  // under that set, not under their own name.
  const city = await resolveRegistryCity(unitName);
  const [cityNames, templates, registry] = await Promise.all([
    unitNamesForRegistryCity(city),
    prisma.lineTemplate.findMany({
      where: { city, isActive: true },
      select: { templateKey: true, description: true, costKey: true },
    }),
    resolveRegistryMap(city),
  ]);

  const rows = await templateLapse(cityNames);
  const byKey = new Map(templates.map((t) => [t.templateKey, t]));

  return rows
    .filter((r) => r.lapsePct >= MIN_LAPSE_PCT && r.budgetCount >= MIN_BUDGETS)
    .flatMap((r) => {
      const t = byKey.get(r.templateKey);
      // A template with no single cost key (a formula over several) has no one
      // rate to move; the admin has to look at the working themselves.
      if (!t?.costKey) return [];
      const currentCost = registry[t.costKey];
      if (!currentCost) return [];
      // Utilisation, not the lapse rate, is what the rate should follow: 70%
      // spent says the standard was worth about 70% of what it claimed.
      const suggestedCost = Math.round((currentCost * r.actual) / r.budgeted);
      if (suggestedCost <= 0 || suggestedCost >= currentCost) return [];
      return [{
        templateKey: r.templateKey,
        itemKey: t.costKey,
        description: t.description,
        currentCost,
        suggestedCost,
        lapsePct: r.lapsePct,
        budgeted: r.budgeted,
        actual: r.actual,
        budgetCount: r.budgetCount,
        partnerCount: r.partnerCount,
      }];
    });
}

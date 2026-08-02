// What a cost-registry edit actually touches. A registry change is futuristic —
// every existing budget froze its own costSnapshot at generation — so this never
// says "these budgets will change". It says which live grants were built on this
// number, which is what an admin needs before moving a standard rate.

import prisma from "@/lib/prisma";
import { GLOBAL_SCOPE } from "@/lib/budget/costRegistry";
import { unitNamesForRegistryCity } from "@/lib/budget/grantingUnits";

export type ImpactedBudget = {
  id: string;
  name: string;
  city: string;
  status: string;
  partnerName: string | null;
  lineCount: number;
};

export type RegistryImpact = {
  itemKey: string;
  /** The registry scopes the edit reaches — itself, or every unit inheriting it. */
  scopes: string[];
  templateKeys: string[];
  budgets: ImpactedBudget[];
};

/**
 * A formula references registry keys as bare identifiers. Match on word
 * boundaries so `creche_rent` doesn't also claim `creche_rent_deposit`.
 */
function formulaReferences(formula: string, itemKey: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${itemKey}([^A-Za-z0-9_]|$)`).test(formula);
}

/**
 * Editing the shared layer reaches every unit that hasn't forked this item —
 * a unit with its own row is unaffected, however the shared number moves.
 */
async function inheritingScopes(itemKey: string): Promise<string[]> {
  const [units, registryCities, overrides] = await Promise.all([
    prisma.grantingUnit.findMany({ select: { registryCity: true } }),
    prisma.costRegistry.findMany({ distinct: ["city"], select: { city: true } }),
    prisma.costRegistry.findMany({ where: { itemKey }, select: { city: true } }),
  ]);
  const owned = new Set(overrides.map((o) => o.city));
  const all = new Set([...units.map((u) => u.registryCity), ...registryCities.map((r) => r.city)]);
  return [...all].filter((c) => c !== GLOBAL_SCOPE && !owned.has(c));
}

export async function registryImpact(city: string, itemKey: string): Promise<RegistryImpact> {
  const scopes = city === GLOBAL_SCOPE ? await inheritingScopes(itemKey) : [city];
  if (scopes.length === 0) return { itemKey, scopes, templateKeys: [], budgets: [] };

  const templates = await prisma.lineTemplate.findMany({
    where: { city: { in: scopes }, isActive: true },
    select: {
      city: true, templateKey: true, formula: true,
      costKey: true, costKey2: true, costKey3: true,
      workerRatioKey: true, bufferKey: true, costPctOf: true,
    },
  });

  // Templates are authored per registry city, so a key can be wired up in one
  // unit and not another. Keep the pairing rather than unioning the keys.
  const keysByScope = new Map<string, string[]>();
  for (const t of templates) {
    const referenced =
      [t.costKey, t.costKey2, t.costKey3, t.workerRatioKey, t.bufferKey, t.costPctOf].includes(itemKey) ||
      (t.formula ? formulaReferences(t.formula, itemKey) : false);
    if (!referenced) continue;
    const list = keysByScope.get(t.city) ?? [];
    list.push(t.templateKey);
    keysByScope.set(t.city, list);
  }

  const templateKeys = [...new Set([...keysByScope.values()].flat())];
  if (templateKeys.length === 0) return { itemKey, scopes, templateKeys: [], budgets: [] };

  const where = await Promise.all(
    [...keysByScope].map(async ([scope, keys]) => ({
      templateKey: { in: keys },
      budget: { city: { in: await unitNamesForRegistryCity(scope) } },
    })),
  );
  const lines = await prisma.budgetLine.groupBy({
    by: ["budgetId"],
    where: { OR: where },
    _count: { _all: true },
  });
  if (lines.length === 0) return { itemKey, scopes, templateKeys, budgets: [] };

  const budgets = await prisma.budget.findMany({
    where: { id: { in: lines.map((l) => l.budgetId) } },
    select: { id: true, name: true, city: true, status: true, grantPartner: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const counts = Object.fromEntries(lines.map((l) => [l.budgetId, l._count._all]));

  return {
    itemKey,
    scopes,
    templateKeys,
    budgets: budgets.map((b) => ({
      id: b.id,
      name: b.name,
      city: b.city,
      status: b.status,
      partnerName: b.grantPartner?.name ?? null,
      lineCount: counts[b.id] ?? 0,
    })),
  };
}

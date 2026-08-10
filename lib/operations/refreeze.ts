// Re-freeze a live centre's CentreCatalog.snapshot from the CURRENT domain CatalogTemplateDef.
//
// The visit catalog is frozen into CentreCatalog.snapshot at go-live (see goLive.ts) and never
// auto-refreshes, so a centre that went live before a catalog edit keeps stale items. This
// recomputes the freeze (normalizeCategories on the current def) and — for the bulk path — writes
// it to every live centre of the catalog's domain. It does NOT touch mode, cadence, the Operations
// pitstop, or already-materialised visit checklist items (those are historical per visit).

import prisma from "@/lib/prisma";
import {
  normalizeCategories,
  resolveEffectiveCatalog,
  type CatalogCategory,
  type CentreCatalogOverrides,
} from "@/lib/catalogDb";

function asCats(snapshot: unknown): CatalogCategory[] {
  if (Array.isArray(snapshot)) return snapshot as CatalogCategory[];
  const c = (snapshot as { categories?: unknown } | null)?.categories;
  return Array.isArray(c) ? (c as CatalogCategory[]) : [];
}

const effKeys = (cats: { key: string; items: { key: string }[] }[]) =>
  new Set(cats.flatMap((c) => c.items.map((i) => `${c.key}::${i.key}`)));

export type CentreRefreezeResult = {
  goalId: string;
  title: string;
  changed: boolean;
  added: string[]; // item texts newly visible in the effective menu
  removed: string[]; // item texts no longer visible
  prunedOverrides: string[]; // addedItems dropped because they now duplicate a snapshot key
};

/**
 * Pure diff + rewrite plan for one centre. Prunes overrides.addedItems that now collide with a
 * snapshot key (they would otherwise render twice once the item is in the snapshot).
 */
export function computeRefreeze(
  snapshotRaw: unknown,
  overridesRaw: unknown,
  defCategories: CatalogCategory[],
): { snapshot: CatalogCategory[]; overrides: CentreCatalogOverrides; result: Omit<CentreRefreezeResult, "goalId" | "title"> } {
  const newSnapshot = normalizeCategories(defCategories);
  const snapKeys = new Set(newSnapshot.flatMap((c) => c.items.map((i) => i.key)));

  const ov: CentreCatalogOverrides = { ...((overridesRaw as CentreCatalogOverrides) ?? {}) };
  const beforeAdded = ov.addedItems ?? [];
  const pruned = beforeAdded.filter((a) => snapKeys.has(a.item.key));
  if (ov.addedItems) ov.addedItems = beforeAdded.filter((a) => !snapKeys.has(a.item.key));

  const before = resolveEffectiveCatalog(asCats(snapshotRaw), overridesRaw as CentreCatalogOverrides);
  const after = resolveEffectiveCatalog(newSnapshot, ov);
  const beforeK = effKeys(before);
  const afterK = effKeys(after);

  const flat = (cats: typeof after) => new Map(cats.flatMap((c) => c.items.map((i) => [`${c.key}::${i.key}`, i.text])));
  const beforeText = flat(before);
  const afterText = flat(after);

  const added = [...afterK].filter((k) => !beforeK.has(k)).map((k) => afterText.get(k)!);
  const removed = [...beforeK].filter((k) => !afterK.has(k)).map((k) => beforeText.get(k)!);
  const snapshotChanged = JSON.stringify(asCats(snapshotRaw)) !== JSON.stringify(newSnapshot);

  return {
    snapshot: newSnapshot,
    overrides: ov,
    result: { changed: added.length > 0 || removed.length > 0 || pruned.length > 0 || snapshotChanged, added, removed, prunedOverrides: pruned.map((a) => a.item.text) },
  };
}

/**
 * Re-freeze every LIVE, non-deleted centre whose catalog matches this def (by slug or shared
 * domain). Pass { apply: false } for a dry-run preview (no writes). Returns a per-centre summary.
 */
export async function refreezeLiveCentresForCatalog(
  catalogId: string,
  opts: { apply: boolean },
): Promise<{ catalogSlug: string; needsDomain: string | null; applied: boolean; centres: CentreRefreezeResult[] }> {
  const def = await prisma.catalogTemplateDef.findUnique({ where: { id: catalogId } });
  if (!def) throw new Error("Catalog not found");

  const centres = await prisma.centreCatalog.findMany({
    where: {
      goal: { deletedAt: null, mode: "live" },
      OR: [
        { catalogSlug: def.slug },
        ...(def.needsDomain ? [{ goal: { needsDomain: def.needsDomain } }] : []),
      ],
    },
    select: { id: true, snapshot: true, overrides: true, goal: { select: { id: true, title: true } } },
    orderBy: { goal: { title: "asc" } },
  });

  const results: CentreRefreezeResult[] = [];
  for (const c of centres) {
    const { snapshot, overrides, result } = computeRefreeze(c.snapshot, c.overrides, def.categories as unknown as CatalogCategory[]);
    if (opts.apply && result.changed) {
      await prisma.centreCatalog.update({
        where: { id: c.id },
        data: { snapshot: snapshot as object[], overrides: overrides as object },
      });
    }
    results.push({ goalId: c.goal.id, title: c.goal.title, ...result });
  }

  return { catalogSlug: def.slug, needsDomain: def.needsDomain, applied: opts.apply, centres: results };
}

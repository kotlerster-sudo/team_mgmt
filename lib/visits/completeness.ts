// Visit completeness — mirrors lib/schoolPlan/completeness.ts semantics: blocksSignoff items are
// mandatory for a clean close, but the gate is SOFT (warn + reason), never a hard block.

import { resolveEffectiveCatalog, type CatalogCategory, type CentreCatalogOverrides } from "@/lib/catalogDb";

export type MissingItem = { categoryKey: string; categoryLabel: string; itemKey: string; text: string };

/**
 * Given a centre's frozen snapshot + overrides and the set of item keys ticked during a visit,
 * return the mandatory (blocksSignoff) items that were NOT ticked. Empty ⇒ visit closes cleanly.
 */
export function missingMandatory(
  snapshot: CatalogCategory[],
  overrides: CentreCatalogOverrides | null | undefined,
  tickedItemKeys: Iterable<string>,
): MissingItem[] {
  const ticked = new Set(tickedItemKeys);
  const out: MissingItem[] = [];
  for (const cat of resolveEffectiveCatalog(snapshot, overrides)) {
    for (const item of cat.items) {
      if (item.blocksSignoff && !ticked.has(item.key)) {
        out.push({ categoryKey: cat.key, categoryLabel: cat.label, itemKey: item.key, text: item.text });
      }
    }
  }
  return out;
}

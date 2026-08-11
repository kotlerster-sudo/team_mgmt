/**
 * Shared constants for the caregiver-practice capture launcher.
 *
 * The capture is reached via ONE visit-catalog item (the "launcher"), recognised
 * by its reserved checklist key. When the visit UI sees a materialised checklist
 * with this key, it opens the full-screen Category→Subcategory→Practice drill
 * instead of the standard complete-activity flow. Kept in one place so the seed
 * that injects the catalog item and the visit UI that recognises it never drift.
 */

import { normalizeCategories, type CatalogItem, type CatalogCategory } from "@/lib/catalogDb";

export const CAREGIVER_PRACTICES_LAUNCHER_KEY = "caregiver-practices-observe";
export const CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY = "caregiver-practices";
export const CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_LABEL = "Caregiver Practices";

/** The catalog item seeded onto creche visit catalogs. One task, opens the drill. */
export const CAREGIVER_PRACTICES_LAUNCHER_ITEM: CatalogItem = {
  key: CAREGIVER_PRACTICES_LAUNCHER_KEY,
  text: "Caregiver practices — observe & flag",
  completionType: "Activity",
  blocksSignoff: true,
};

/** The 5 statuses considered "open" (carry forward to the next visit). */
export const OPEN_PRACTICE_STATUSES = ["NeedsImprovement", "NotPracticed"] as const;

// ── Launcher <-> catalog "binding" helpers (used by the backend toolbox + the seed script) ──
// A catalog is "bound" to the Caregiver-Practices subsystem iff it contains the reserved launcher
// item. Adding/removing the launcher is the binding — RP behaviour is unchanged (still keyed).

export function hasLauncher(categories: CatalogCategory[]): boolean {
  return (categories ?? []).some((c) => (c.items ?? []).some((i) => i.key === CAREGIVER_PRACTICES_LAUNCHER_KEY));
}

export function withLauncher(categories: CatalogCategory[]): CatalogCategory[] {
  const cats = normalizeCategories(categories ?? []);
  if (hasLauncher(cats)) return cats;
  const cat = cats.find((c) => c.key === CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY);
  if (cat) { cat.items.push({ ...CAREGIVER_PRACTICES_LAUNCHER_ITEM }); return cats; }
  return [...cats, { key: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY, label: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_LABEL, items: [{ ...CAREGIVER_PRACTICES_LAUNCHER_ITEM }] }];
}

/** Remove the launcher item; drop the reserved category if it becomes empty. */
export function withoutLauncher(categories: CatalogCategory[]): CatalogCategory[] {
  return normalizeCategories(categories ?? [])
    .map((c) => ({ ...c, items: (c.items ?? []).filter((i) => i.key !== CAREGIVER_PRACTICES_LAUNCHER_KEY) }))
    .filter((c) => !(c.key === CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY && c.items.length === 0));
}

/**
 * Shared constants for the caregiver-practice capture launcher.
 *
 * The capture is reached via ONE visit-catalog item (the "launcher"), recognised
 * by its reserved checklist key. When the visit UI sees a materialised checklist
 * with this key, it opens the full-screen Category→Subcategory→Practice drill
 * instead of the standard complete-activity flow. Kept in one place so the seed
 * that injects the catalog item and the visit UI that recognises it never drift.
 */

import type { CatalogItem } from "@/lib/catalogDb";

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

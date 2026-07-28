// Types + helpers for the LIVE-centre visit catalog (CatalogTemplateDef domain defaults +
// per-centre CentreCatalog snapshot/overrides). Deliberately parallel to lib/templateDb.ts:
// the catalog is a "menu of things to do on a visit", not an SLA-scheduled milestone tree.

import { slugifyChecklistText } from "@/lib/templateDb";

export type CadencePeriod = "week" | "month";

export interface Cadence {
  count: number;
  period: CadencePeriod;
}

// One tickable thing inside a category. `blocksSignoff` mirrors SchoolPlanStep.blocksSignoff:
// true (default) = mandatory for a visit to close cleanly (soft-warn, not hard-block).
export interface CatalogItem {
  key: string;
  text: string;
  completionType: string; // "" | "Activity" | "Voice" | "Upload"
  blocksSignoff: boolean;
  // When present, this item is a *tagged* goal-template checklist item rather than free text.
  // On visit materialisation the real ChecklistItem is stamped with these so indicator/journey
  // bindings (keyed on templateSlug+checklistKey) resolve. Absent = legacy free-text / ad-hoc.
  ref?: { templateSlug: string; checklistKey: string };
}

export interface CatalogCategory {
  key: string;
  label: string;
  items: CatalogItem[];
}

// Shape stored in CatalogTemplateDef.categories (the authored domain default).
export interface CatalogTemplate {
  id: string;
  slug: string;
  name: string;
  needsDomain: string | null;
  categories: CatalogCategory[];
  defaultCadenceCount: number | null;
  defaultCadencePeriod: CadencePeriod | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Sparse per-centre patch stored in CentreCatalog.overrides. Applied on top of the frozen
// snapshot to produce the effective menu. Everything here is optional.
export interface CentreCatalogOverrides {
  // Extra categories the centre added (each with its own items).
  addedCategories?: CatalogCategory[];
  // Extra items added into an existing snapshot category, keyed by category key.
  addedItems?: { categoryKey: string; item: CatalogItem }[];
  // Item/category keys hidden from the snapshot (never hard-delete the snapshot).
  hiddenKeys?: string[];
  // Field-level edits to snapshot items, keyed by item key.
  edits?: Record<string, Partial<Pick<CatalogItem, "text" | "blocksSignoff">>>;
}

// Provenance for a resolved item so the UI can badge added/edited items and gate on approval.
export type ItemSource = "standard" | "added";

export interface ResolvedCatalogItem extends CatalogItem {
  source: ItemSource;
  edited: boolean;
}

export interface ResolvedCatalogCategory {
  key: string;
  label: string;
  source: ItemSource;
  items: ResolvedCatalogItem[];
}

function toItem(raw: Partial<CatalogItem> & { text: string }): CatalogItem {
  return {
    key: raw.key || slugifyChecklistText(raw.text),
    text: raw.text,
    completionType: raw.completionType ?? "Activity",
    // default mandatory unless explicitly opted out (mirrors blocksSignoff default true)
    blocksSignoff: raw.blocksSignoff ?? true,
    ...(raw.ref ? { ref: raw.ref } : {}),
  };
}

/** Normalise an authored category tree, filling in stable keys + item defaults. */
export function normalizeCategories(categories: CatalogCategory[]): CatalogCategory[] {
  return (categories ?? []).map((c) => ({
    key: c.key || slugifyChecklistText(c.label),
    label: c.label,
    items: (c.items ?? []).map(toItem),
  }));
}

/**
 * Merge a frozen snapshot with a centre's sparse overrides into the effective menu.
 * Pure — approval status (CatalogItemApproval) is layered separately by the caller.
 */
export function resolveEffectiveCatalog(
  snapshot: CatalogCategory[],
  overrides: CentreCatalogOverrides | null | undefined,
): ResolvedCatalogCategory[] {
  const ov = overrides ?? {};
  const hidden = new Set(ov.hiddenKeys ?? []);
  const edits = ov.edits ?? {};
  const addedByCat = new Map<string, CatalogItem[]>();
  for (const a of ov.addedItems ?? []) {
    const list = addedByCat.get(a.categoryKey) ?? [];
    list.push(toItem(a.item));
    addedByCat.set(a.categoryKey, list);
  }

  const applyEdit = (item: CatalogItem, source: ItemSource): ResolvedCatalogItem => {
    const e = edits[item.key];
    return {
      ...item,
      text: e?.text ?? item.text,
      blocksSignoff: e?.blocksSignoff ?? item.blocksSignoff,
      source,
      edited: Boolean(e),
    };
  };

  const out: ResolvedCatalogCategory[] = [];

  for (const cat of normalizeCategories(snapshot)) {
    if (hidden.has(cat.key)) continue;
    const items: ResolvedCatalogItem[] = [];
    for (const item of cat.items) {
      if (hidden.has(item.key)) continue;
      items.push(applyEdit(item, "standard"));
    }
    for (const added of addedByCat.get(cat.key) ?? []) {
      if (hidden.has(added.key)) continue;
      items.push(applyEdit(added, "added"));
    }
    out.push({ key: cat.key, label: cat.label, source: "standard", items });
  }

  for (const cat of normalizeCategories(ov.addedCategories ?? [])) {
    if (hidden.has(cat.key)) continue;
    const items = cat.items
      .filter((i) => !hidden.has(i.key))
      .map((i) => applyEdit(i, "added"));
    out.push({ key: cat.key, label: cat.label, source: "added", items });
  }

  return out;
}

/** Resolve a centre's effective cadence (per-centre override wins over the domain default). */
export function resolveCadence(
  centre: { cadenceCount: number | null; cadencePeriod: string | null } | null,
  def: { defaultCadenceCount: number | null; defaultCadencePeriod: string | null } | null,
): Cadence | null {
  const count = centre?.cadenceCount ?? def?.defaultCadenceCount ?? null;
  const period = (centre?.cadencePeriod ?? def?.defaultCadencePeriod ?? null) as CadencePeriod | null;
  if (!count || !period) return null;
  return { count, period };
}

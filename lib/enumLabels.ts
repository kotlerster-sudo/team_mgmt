// De-hardcoded enum display labels (EnumLabelConfig). The `code` is the stable enum value that code
// branches on; only label/color/meta/order are editable. Defaults below mirror the values that were
// previously hardcoded — seeded lazily on first read per enumKey, so nothing breaks if the table is
// empty. Consumers fall back to these defaults if the fetch fails.

import prisma from "@/lib/prisma";

export type EnumLabel = { code: string; label: string; color: string | null; meta: Record<string, unknown>; sortOrder: number };

export const ENUM_LABEL_DEFAULTS: Record<string, EnumLabel[]> = {
  CaregiverPracticeStatus: [
    { code: "OK", label: "OK", color: "bg-emerald-500 text-white border-emerald-500", meta: { flag: false }, sortOrder: 0 },
    { code: "NeedsImprovement", label: "Needs impr.", color: "bg-amber-400 text-amber-950 border-amber-400", meta: { flag: true }, sortOrder: 1 },
    { code: "NotPracticed", label: "Not done", color: "bg-red-500 text-white border-red-500", meta: { flag: true }, sortOrder: 2 },
    { code: "NotObserved", label: "Not obs.", color: "bg-stone-400 text-white border-stone-400", meta: { flag: false }, sortOrder: 3 },
    { code: "NotApplicable", label: "N/A", color: "bg-stone-300 text-stone-700 border-stone-300", meta: { flag: false }, sortOrder: 4 },
  ],
  CaregiverPracticeAction: [
    { code: "FeedbackOnSpot", label: "Feedback given", color: null, meta: {}, sortOrder: 0 },
    { code: "RefresherPlanned", label: "Refresher", color: null, meta: {}, sortOrder: 1 },
    { code: "EscalateToSupervisor", label: "Escalate", color: null, meta: {}, sortOrder: 2 },
  ],
  FacilityIndicatorSource: [
    { code: "MIS_API", label: "MIS API", color: null, meta: {}, sortOrder: 0 },
    { code: "RP_ACTIVITY", label: "RP activity", color: null, meta: {}, sortOrder: 1 },
    { code: "MANUAL_ADMIN", label: "Manual (admin)", color: null, meta: {}, sortOrder: 2 },
  ],
};

export const ENUM_LABEL_KEYS = Object.keys(ENUM_LABEL_DEFAULTS);

/** Read the labels for an enum, seeding defaults lazily if the table has none for it yet. */
export async function getEnumLabels(enumKey: string): Promise<EnumLabel[]> {
  const defaults = ENUM_LABEL_DEFAULTS[enumKey];
  if (!defaults) return [];
  let rows = await prisma.enumLabelConfig.findMany({ where: { enumKey }, orderBy: { sortOrder: "asc" } });
  if (rows.length === 0) {
    await prisma.enumLabelConfig.createMany({
      data: defaults.map((d) => ({ enumKey, code: d.code, label: d.label, color: d.color, meta: d.meta as object, sortOrder: d.sortOrder })),
      skipDuplicates: true,
    });
    rows = await prisma.enumLabelConfig.findMany({ where: { enumKey }, orderBy: { sortOrder: "asc" } });
  }
  return rows.map((r) => ({ code: r.code, label: r.label, color: r.color, meta: (r.meta as Record<string, unknown>) ?? {}, sortOrder: r.sortOrder }));
}

// Relational readers that reconstruct the legacy JSON shapes (DbPitstop[] / CatalogCategory[]) from
// the config-graph tables — the P3 read cutover. Gated by RELATIONAL_READS (default OFF): consumers
// (templateSync, goLive, materialise, template apply) read JSON until the flag is flipped, so prod
// behaviour is unchanged and revertible. Keys are emitted explicitly (= the same value consumers
// compute via key ?? slugify(text)), so output is semantically identical to the JSON.

import prisma from "@/lib/prisma";
import type { DbPitstop } from "@/lib/templateDb";
import type { CatalogCategory } from "@/lib/catalogDb";

export const RELATIONAL_READS = process.env.CONTROL_PLANE_RELATIONAL_READS === "1";

/** Reconstruct GoalTemplateDef.pitstops from TemplatePitstopDef→ChecklistDef→ActivityDef. */
export async function templatePitstopsFromRelational(templateId: string): Promise<DbPitstop[]> {
  const pitstops = await prisma.templatePitstopDef.findMany({
    where: { templateId },
    orderBy: { order: "asc" },
    select: {
      key: true, title: true, type: true, notes: true, slaDays: true, startSlaDays: true, recurrence: true, repeatCount: true, progressTag: true,
      checklist: {
        orderBy: { order: "asc" },
        select: { key: true, text: true, completionType: true, activities: { orderBy: { order: "asc" }, select: { key: true, title: true, completionType: true, dayOffset: true } } },
      },
    },
  });
  return pitstops.map((p) => ({
    title: p.title, type: p.type, notes: p.notes, slaDays: p.slaDays, startSlaDays: p.startSlaDays,
    recurrence: p.recurrence, repeatCount: p.repeatCount, progressTag: p.progressTag ?? undefined, key: p.key,
    checklist: p.checklist.map((c) => ({
      text: c.text, key: c.key, completionType: c.completionType || undefined,
      activities: c.activities.map((a) => ({ title: a.title, completionType: a.completionType, key: a.key, ...(a.dayOffset != null ? { dayOffset: a.dayOffset } : {}) })),
    })),
  }));
}

/** Same, resolved by template slug (returns [] if the template doesn't exist). */
export async function templatePitstopsFromRelationalBySlug(slug: string): Promise<DbPitstop[]> {
  const t = await prisma.goalTemplateDef.findUnique({ where: { slug }, select: { id: true } });
  return t ? templatePitstopsFromRelational(t.id) : [];
}

/** Reconstruct CatalogTemplateDef.categories from CatalogCategoryDef→CatalogItemDef. */
export async function catalogCategoriesFromRelational(catalogId: string): Promise<CatalogCategory[]> {
  const cats = await prisma.catalogCategoryDef.findMany({
    where: { catalogId },
    orderBy: { order: "asc" },
    select: {
      key: true, label: true,
      items: { orderBy: { order: "asc" }, select: { key: true, text: true, completionType: true, blocksSignoff: true, refTemplateSlug: true, refChecklistKey: true } },
    },
  });
  return cats.map((c) => ({
    key: c.key, label: c.label,
    items: c.items.map((i) => ({
      key: i.key, text: i.text, completionType: i.completionType, blocksSignoff: i.blocksSignoff,
      ...(i.refTemplateSlug && i.refChecklistKey ? { ref: { templateSlug: i.refTemplateSlug, checklistKey: i.refChecklistKey } } : {}),
    })),
  }));
}

// Relational-backed checklist-key reads + validation (part of the read cutover + integrity layer).
// The valid key universe = template checklist keys ∪ catalog-ref keys (a catalog item materialises
// its ref key on a visit). Used to enumerate taggable keys and to reject bindings on non-existent
// keys before they become silent orphans.

import prisma from "@/lib/prisma";

export type TemplateKeyGroup = {
  slug: string;
  name: string;
  domain: string | null;
  items: { key: string; text: string; pitstopTitle: string }[];
};

/** Enumerate checklist keys per active template, from the relational tables (was JSON-parsed). */
export async function listTemplateChecklistKeys(): Promise<TemplateKeyGroup[]> {
  const templates = await prisma.goalTemplateDef.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      slug: true, name: true, needsDomain: true,
      pitstopDefs: { orderBy: { order: "asc" }, select: { title: true, checklist: { orderBy: { order: "asc" }, select: { key: true, text: true } } } },
    },
  });
  return templates.map((t) => ({
    slug: t.slug,
    name: t.name,
    domain: t.needsDomain,
    items: t.pitstopDefs.flatMap((p) => p.checklist.map((c) => ({ key: c.key, text: c.text, pitstopTitle: p.title }))),
  }));
}

/** True if (templateSlug, checklistKey) exists as a template checklist item OR a catalog-ref anchor. */
export async function isValidChecklistKey(templateSlug: string, checklistKey: string): Promise<boolean> {
  const inTemplate = await prisma.templateChecklistDef.count({ where: { key: checklistKey, pitstop: { template: { slug: templateSlug } } } });
  if (inTemplate > 0) return true;
  const inCatalog = await prisma.catalogItemDef.count({ where: { refTemplateSlug: templateSlug, refChecklistKey: checklistKey } });
  return inCatalog > 0;
}

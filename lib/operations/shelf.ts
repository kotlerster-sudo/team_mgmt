/**
 * Catalog-shelf data for the supervisor "deploy items" flow.
 *
 * A supervisor picks an RP → one of their LIVE centres → items off a shelf sourced from the
 * centre's domain goal-templates (checklist items, each with its resolved completionType and
 * whether it captures an indicator). Deploying appends them to the centre's catalog overrides
 * (see /api/operations/centres/[goalId]/deploy-items). Items already on the centre's catalog are
 * flagged so they can't be double-added.
 */

import prisma from "@/lib/prisma";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import {
  resolveEffectiveCatalog, type CatalogCategory, type CentreCatalogOverrides,
} from "@/lib/catalogDb";
import {
  slugifyChecklistText, normalizeActivities, type DbPitstop, type DbChecklistItem,
} from "@/lib/templateDb";

export type ShelfChecklist = {
  templateSlug: string;
  checklistKey: string;
  text: string;
  completionType: string;
  hasIndicator: boolean;
};
export type ShelfGroup = {
  templateSlug: string;
  templateName: string;
  pitstopTitle: string;
  items: ShelfChecklist[];
};
export type ShelfCentre = {
  goalId: string;
  name: string;
  needsDomain: string | null;
  existingKeys: string[];
  shelf: ShelfGroup[];
};
export type ShelfRp = { id: string; name: string | null; centres: ShelfCentre[] };

const ckKey = (c: DbChecklistItem) => c.key || slugifyChecklistText(c.text);
const psKey = (p: DbPitstop) => p.key || slugifyChecklistText(p.title);
const ckCompletion = (c: DbChecklistItem) =>
  c.completionType || normalizeActivities(c)[0]?.completionType || "Activity";

/** Template checklist items available for a domain, grouped by template → pitstop. */
async function loadShelfForDomains(domains: string[]): Promise<Map<string, ShelfGroup[]>> {
  const out = new Map<string, ShelfGroup[]>();
  if (domains.length === 0) return out;

  const defs = await prisma.goalTemplateDef.findMany({
    where: { needsDomain: { in: domains }, isActive: true },
    select: { slug: true, name: true, needsDomain: true, pitstops: true },
    orderBy: { sortOrder: "asc" },
  });

  const bindings = await prisma.activityIndicatorBinding.findMany({
    where: { templateSlug: { in: defs.map((d) => d.slug) } },
    select: { templateSlug: true, checklistKey: true },
  });
  const bound = new Set(bindings.map((b) => `${b.templateSlug}::${b.checklistKey}`));

  for (const d of defs) {
    if (!d.needsDomain) continue;
    const groups: ShelfGroup[] = [];
    for (const p of (d.pitstops ?? []) as unknown as DbPitstop[]) {
      const items: ShelfChecklist[] = (p.checklist ?? []).map((c) => {
        const key = ckKey(c);
        return {
          templateSlug: d.slug,
          checklistKey: key,
          text: c.text,
          completionType: ckCompletion(c),
          hasIndicator: bound.has(`${d.slug}::${key}`),
        };
      });
      if (items.length > 0) groups.push({ templateSlug: d.slug, templateName: d.name, pitstopTitle: p.title, items });
    }
    const list = out.get(d.needsDomain) ?? [];
    list.push(...groups);
    out.set(d.needsDomain, list);
  }
  return out;
}

export async function loadShelfData(userIds: string[]): Promise<ShelfRp[]> {
  const goals = await prisma.goal.findMany({
    where: { AND: [goalOwnedByAnyOf(userIds), { deletedAt: null, mode: "live", status: { not: "Complete" } }] },
    select: {
      id: true, title: true, needsDomain: true,
      owner: { select: { id: true, name: true } },
      linkedFacility: { select: { name: true } },
      centreCatalog: { select: { snapshot: true, overrides: true } },
    },
  });
  const liveGoals = goals.filter((g) => g.centreCatalog); // only centres with a real catalog

  const domains = [...new Set(liveGoals.map((g) => g.needsDomain).filter((d): d is string => !!d))];
  const shelfByDomain = await loadShelfForDomains(domains);

  const byRp = new Map<string, ShelfRp>();
  for (const g of liveGoals) {
    const ownerId = g.owner?.id;
    if (!ownerId) continue;
    const snapshot = (g.centreCatalog!.snapshot ?? []) as unknown as CatalogCategory[];
    const overrides = (g.centreCatalog!.overrides ?? {}) as unknown as CentreCatalogOverrides;
    const existingKeys = resolveEffectiveCatalog(snapshot, overrides).flatMap((c) => c.items).map((i) => i.key);

    const centre: ShelfCentre = {
      goalId: g.id,
      name: g.linkedFacility?.name ?? g.title,
      needsDomain: g.needsDomain,
      existingKeys,
      shelf: g.needsDomain ? (shelfByDomain.get(g.needsDomain) ?? []) : [],
    };

    let rp = byRp.get(ownerId);
    if (!rp) { rp = { id: ownerId, name: g.owner?.name ?? null, centres: [] }; byRp.set(ownerId, rp); }
    rp.centres.push(centre);
  }

  const rps = [...byRp.values()];
  for (const rp of rps) rp.centres.sort((a, b) => a.name.localeCompare(b.name));
  rps.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~"));
  return rps;
}

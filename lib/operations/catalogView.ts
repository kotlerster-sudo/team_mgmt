/**
 * Shared visit-catalog resolution for a single centre. Powers BOTH the read-only catalog
 * viewer on the centre-detail page and the visit route's live screen — one source of truth
 * for "what's on this centre's catalog, its cadence, and which items are pending approval".
 *
 * Deliberately NOT visit-specific: it knows nothing about the current in-progress visit or
 * which items are ticked. The visit route layers that on top of `live.categories`.
 */

import prisma from "@/lib/prisma";
import {
  resolveEffectiveCatalog, resolveCadence,
  type Cadence, type CatalogCategory, type CentreCatalogOverrides,
} from "@/lib/catalogDb";
import { monthBounds, requiredVisitsForMonth } from "./month";

export type CatalogItemView = {
  key: string;
  text: string;
  completionType: string;
  /** blocksSignoff — soft-mandatory for a clean visit close. */
  mandatory: boolean;
  /** "standard" (from the snapshot) | "added" (ad-hoc override). */
  source: string;
  /** null | "pending" | "approved" | "rejected" — layered from CatalogItemApproval. */
  approval: string | null;
};

export type CatalogCategoryView = { key: string; label: string; items: CatalogItemView[] };

export type CentreCatalogView = {
  goalId: string;
  title: string;
  clusterName: string | null;
  settlementName: string | null;
  /** Goal.mode — "setup" | "live". */
  mode: string;
  /** True when the centre's domain has an active catalog template (→ go-live will be useful). */
  hasDomainCatalog: boolean;
  /** Populated only once the centre is live AND has a CentreCatalog. */
  live: {
    livePitstopId: string;
    catalogSlug: string;
    cadence: Cadence | null;
    monthRequired: number;
    monthDone: number;
    categories: CatalogCategoryView[];
  } | null;
};

export async function loadCentreCatalogView(
  goalId: string,
  now: Date = new Date(),
): Promise<CentreCatalogView | null> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true, title: true, mode: true, needsDomain: true,
      needsCluster: { select: { name: true } },
      needsSettlement: { select: { name: true, cluster: { select: { name: true } } } },
      linkedFacility: { select: { layerKey: true } },
      centreCatalog: { select: { catalogSlug: true, snapshot: true, overrides: true, cadenceCount: true, cadencePeriod: true } },
      pitstops: { where: { deletedAt: null, recurrence: { not: "None" } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!goal) return null;

  const clusterName = goal.needsCluster?.name ?? goal.needsSettlement?.cluster?.name ?? null;
  const settlementName = goal.needsSettlement?.name ?? null;

  // Does this centre's domain have an active catalog template? (predicts a useful go-live.)
  const hasDomainCatalog = goal.needsDomain
    ? (await prisma.catalogTemplateDef.count({ where: { needsDomain: goal.needsDomain, isActive: true } })) > 0
    : false;

  const base = {
    goalId: goal.id, title: goal.title, clusterName, settlementName,
    mode: goal.mode, hasDomainCatalog,
  };

  // Live layer only when the centre is live, has a snapshot, and a recurring pitstop.
  if (goal.mode !== "live" || !goal.centreCatalog || goal.pitstops.length === 0) {
    return { ...base, live: null };
  }

  const snapshot = (goal.centreCatalog.snapshot ?? []) as unknown as CatalogCategory[];
  const overrides = (goal.centreCatalog.overrides ?? {}) as unknown as CentreCatalogOverrides;
  const cadence = resolveCadence(goal.centreCatalog, { defaultCadenceCount: null, defaultCadencePeriod: null });
  const livePitstopId = goal.pitstops[0].id;

  const approvals = await prisma.catalogItemApproval.findMany({
    where: { goalId },
    select: { itemKey: true, status: true },
  });
  const approvalByKey = new Map(approvals.map((a) => [a.itemKey, a.status]));

  const { start, end } = monthBounds(now);
  const monthDone = await prisma.pitstopEvent.count({
    where: {
      type: "Visit", visitEventId: null, status: "Done", deletedAt: null,
      completedAt: { gte: start, lte: end },
      pitstops: { some: { pitstopId: livePitstopId } },
    },
  });

  const categories: CatalogCategoryView[] = resolveEffectiveCatalog(snapshot, overrides).map((cat) => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map((it) => ({
      key: it.key, text: it.text, completionType: it.completionType,
      mandatory: it.blocksSignoff, source: it.source,
      approval: approvalByKey.get(it.key) ?? null,
    })),
  }));

  return {
    ...base,
    live: {
      livePitstopId,
      catalogSlug: goal.centreCatalog.catalogSlug,
      cadence,
      monthRequired: requiredVisitsForMonth(cadence, now),
      monthDone,
      categories,
    },
  };
}

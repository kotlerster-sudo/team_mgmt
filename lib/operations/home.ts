/**
 * Operations home loader — the theme tiles.
 *
 * Loads the person's owned goals once, groups them into themes, and derives a
 * lifecycle count per theme (setting-up / live / done) so the home can render
 * one tile per theme the person actually works in. Lightweight: no per-centre
 * event queries here (the portal does that when opened).
 */

import prisma from "@/lib/prisma";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import { resolveCadence } from "@/lib/catalogDb";
import { deriveCentrePhase, type PhasePitstop } from "./phase";
import { goalInClusterFilter } from "./clusters";
import { monthBounds, prevMonthBounds, requiredVisitsForMonth, doneVisitsByGoal } from "./month";
import { loadThemeCatalog, loadLayerToDomain, resolveGoalThemeKey, indexThemes, type ThemeDef } from "./themes";

export type ThemeTile = {
  theme: ThemeDef;
  settingUp: number;
  live: number;
  done: number;
  total: number;
  /** Live centres in this theme that are below their required visits this month. */
  needsVisitCentres: number;
  /** Sum of remaining visits (required − done) across those centres. */
  visitsToGo: number;
  /** Visits completed this month across this theme's live centres. */
  monthDone: number;
  /** Visits required this month across this theme's live centres. */
  monthRequired: number;
  /** Live centres that fell short of their cadence last month. */
  missedCentres: number;
  /** Sum of last month's cadence shortfall across those centres. */
  missedVisits: number;
};

type MonthAgg = {
  settingUp: number; live: number; done: number; total: number;
  needsVisitCentres: number; visitsToGo: number;
  monthDone: number; monthRequired: number;
  missedCentres: number; missedVisits: number;
};
const emptyAgg = (): MonthAgg => ({
  settingUp: 0, live: 0, done: 0, total: 0,
  needsVisitCentres: 0, visitsToGo: 0, monthDone: 0, monthRequired: 0, missedCentres: 0, missedVisits: 0,
});

export async function loadOperationsHome(
  userIds: string[],
  opts: { now?: Date; clusterId?: string } = {},
): Promise<ThemeTile[]> {
  const now = opts.now ?? new Date();
  const [catalog, layerToDomain, goals] = await Promise.all([
    loadThemeCatalog(),
    loadLayerToDomain(),
    prisma.goal.findMany({
      where: {
        AND: [
          goalOwnedByAnyOf(userIds),
          { deletedAt: null, status: { not: "Complete" } },
          ...(opts.clusterId ? [goalInClusterFilter(opts.clusterId)] : []),
        ],
      },
      select: {
        id: true,
        mode: true,
        needsDomain: true,
        linkedFacility: { select: { layerKey: true } },
        centreCatalog: { select: { cadenceCount: true, cadencePeriod: true } },
        pitstops: {
          where: { deletedAt: null },
          select: { id: true, status: true, recurrence: true, order: true, progressTag: true, title: true },
        },
      },
    }),
  ]);

  // Monthly visit cadence per live centre — visits done this month + last month, so the tile
  // reflects the monthly rhythm (needs-a-visit / missed-last-month), matching the theme portal.
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const liveGoalIds = goals.filter((g) => g.mode === "live").map((g) => g.id);
  const [doneThis, doneLast] = await Promise.all([
    doneVisitsByGoal(liveGoalIds, monthBounds(now)),
    doneVisitsByGoal(liveGoalIds, prevMonthBounds(now)),
  ]);

  const themeIndex = indexThemes(catalog);
  const buckets = new Map<string, MonthAgg>();

  for (const g of goals) {
    const key = resolveGoalThemeKey(g, layerToDomain);
    if (!key) continue;
    const phase = deriveCentrePhase(g.pitstops as PhasePitstop[], { mode: g.mode });
    const b = buckets.get(key) ?? emptyAgg();
    b.total += 1;
    if (phase.lifecycle === "setting_up") b.settingUp += 1;
    else if (phase.lifecycle === "live") b.live += 1;
    else b.done += 1;

    if (g.mode === "live") {
      const cadence = resolveCadence(g.centreCatalog, null);
      const required = requiredVisitsForMonth(cadence, now);
      const requiredLast = requiredVisitsForMonth(cadence, lastMonthDate);
      const done = doneThis.get(g.id) ?? 0;
      const missed = Math.max(0, requiredLast - (doneLast.get(g.id) ?? 0));
      b.monthDone += done;
      b.monthRequired += required;
      if (required > done) { b.needsVisitCentres += 1; b.visitsToGo += required - done; }
      if (missed > 0) { b.missedCentres += 1; b.missedVisits += missed; }
    }
    buckets.set(key, b);
  }

  const tiles: ThemeTile[] = [];
  for (const [key, b] of buckets) {
    const theme: ThemeDef =
      themeIndex.get(key) ?? { key, label: key, color: "#6b7280", layerKey: null, isFacility: false, sortOrder: 999 };
    tiles.push({ theme, ...b });
  }

  tiles.sort((a, b) => a.theme.sortOrder - b.theme.sortOrder || a.theme.label.localeCompare(b.theme.label));
  return tiles;
}

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
import { deriveCentrePhase, type PhasePitstop } from "./phase";
import { goalInClusterFilter } from "./clusters";
import { loadThemeCatalog, loadLayerToDomain, resolveGoalThemeKey, indexThemes, type ThemeDef } from "./themes";

export type ThemeTile = {
  theme: ThemeDef;
  settingUp: number;
  live: number;
  done: number;
  total: number;
  /** Activities scheduled today across this theme's centres. */
  today: number;
  /** Non-Done activities scheduled before today across this theme's centres. */
  overdue: number;
};

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
        pitstops: {
          where: { deletedAt: null },
          select: { id: true, status: true, recurrence: true, order: true, progressTag: true, title: true },
        },
      },
    }),
  ]);

  // Today + overdue event counts per goal (scheduledAt-based, so the tile totals
  // match what the theme portal sums per centre). One query for the whole set.
  const pitstopToGoal = new Map<string, string>();
  for (const g of goals) for (const p of g.pitstops) pitstopToGoal.set(p.id, g.id);
  const pitstopIds = [...pitstopToGoal.keys()];
  const todayByGoal = new Map<string, number>();
  const overdueByGoal = new Map<string, number>();
  if (pitstopIds.length > 0) {
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const events = await prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        status: { not: "Cancelled" },
        scheduledAt: { lte: todayEnd },
        pitstops: { some: { pitstopId: { in: pitstopIds } } },
      },
      select: { status: true, scheduledAt: true, pitstops: { select: { pitstopId: true } } },
    });
    for (const e of events) {
      const goalIds = new Set<string>();
      for (const link of e.pitstops) { const gid = pitstopToGoal.get(link.pitstopId); if (gid) goalIds.add(gid); }
      const isToday = e.scheduledAt >= todayStart && e.scheduledAt <= todayEnd;
      const isOverdue = e.scheduledAt < todayStart && e.status !== "Done";
      for (const gid of goalIds) {
        if (isToday) todayByGoal.set(gid, (todayByGoal.get(gid) ?? 0) + 1);
        if (isOverdue) overdueByGoal.set(gid, (overdueByGoal.get(gid) ?? 0) + 1);
      }
    }
  }

  const themeIndex = indexThemes(catalog);
  const buckets = new Map<string, { settingUp: number; live: number; done: number; total: number; today: number; overdue: number }>();

  for (const g of goals) {
    const key = resolveGoalThemeKey(g, layerToDomain);
    if (!key) continue;
    const phase = deriveCentrePhase(g.pitstops as PhasePitstop[], { mode: g.mode });
    const b = buckets.get(key) ?? { settingUp: 0, live: 0, done: 0, total: 0, today: 0, overdue: 0 };
    b.total += 1;
    if (phase.lifecycle === "setting_up") b.settingUp += 1;
    else if (phase.lifecycle === "live") b.live += 1;
    else b.done += 1;
    b.today += todayByGoal.get(g.id) ?? 0;
    b.overdue += overdueByGoal.get(g.id) ?? 0;
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

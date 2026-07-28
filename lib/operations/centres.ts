/**
 * Centre loading for the Operations world.
 *
 * A "centre" is a goal the person owns within a theme — for facility themes it
 * resolves to the linked LayerFeature (Abdul's 23 creches = 23 goals), for
 * non-facility themes it's the goal's cluster/settlement scope. For each centre
 * we derive its lifecycle phase (from pitstops) and its this-month visit status
 * (from PitstopEvents) so the portal can render:
 *
 *   SETTING UP · Munireddypalya · Infrastructure · 2/6
 *   LIVE       · Peenya West     · ●○○ 1/3 this month
 *
 * Reads the spine only — no new tables, no writes.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import prisma from "@/lib/prisma";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import { deriveCentrePhase, type CentrePhase, type PhasePitstop } from "./phase";
import { goalInClusterFilter } from "./clusters";
import type { ThemeDef } from "./themes";

export type CentreRow = {
  goalId: string;
  /** Display name: linked facility name, else goal title. */
  name: string;
  /** Explicit operations mode ("setup" | "live") — authoritative for visit-vs-classic routing. */
  mode: string;
  cluster: { id: string; name: string } | null;
  settlement: { id: string; name: string } | null;
  phase: CentrePhase;
  /** This calendar month's activity progress on this centre. */
  month: { done: number; total: number };
  /** Non-Done activities scheduled before today. */
  overdue: number;
  /** Activities scheduled today (any status). */
  today: number;
};

function monthBounds(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

const PITSTOP_SELECT = {
  id: true,
  status: true,
  recurrence: true,
  order: true,
  progressTag: true,
  title: true,
} as const;

/**
 * Load the person's centres within a theme, with derived phase + this-month
 * status. `userIds` is the ownership set (self for RP; self+team for
 * supervisors — caller decides).
 */
export async function loadCentresForTheme(
  userIds: string[],
  theme: ThemeDef,
  opts: { now?: Date; clusterId?: string } = {},
): Promise<CentreRow[]> {
  const now = opts.now ?? new Date();
  // A goal belongs to this theme by explicit needsDomain, or (for facility
  // themes) by its linked facility's layer when needsDomain is unset.
  const themeMatch: Prisma.GoalWhereInput = theme.isFacility
    ? {
        OR: [
          { needsDomain: theme.key },
          { needsDomain: null, linkedFacility: { layerKey: theme.layerKey ?? "__none__" } },
        ],
      }
    : { needsDomain: theme.key };

  const goals = await prisma.goal.findMany({
    where: {
      AND: [
        goalOwnedByAnyOf(userIds),
        { deletedAt: null, status: { not: "Complete" } },
        themeMatch,
        ...(opts.clusterId ? [goalInClusterFilter(opts.clusterId)] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      mode: true,
      needsCluster: { select: { id: true, name: true } },
      needsSettlement: { select: { id: true, name: true } },
      linkedFacility: {
        select: { name: true, cluster: { select: { id: true, name: true } }, settlement: { select: { id: true, name: true } } },
      },
      pitstops: { where: { deletedAt: null }, select: PITSTOP_SELECT },
    },
  });

  if (goals.length === 0) return [];

  // One event query for the whole theme's pitstops in the current month.
  const pitstopToGoal = new Map<string, string>();
  for (const g of goals) for (const p of g.pitstops) pitstopToGoal.set(p.id, g.id);
  const pitstopIds = [...pitstopToGoal.keys()];

  type Agg = { done: number; total: number; overdue: number; today: number };
  const totals = new Map<string, Agg>();
  if (pitstopIds.length > 0) {
    const { start: monthStart, end: monthEnd } = monthBounds(now);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    // One query wide enough for month totals + overdue (past, non-Done) + today.
    const events = await prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        status: { not: "Cancelled" },
        scheduledAt: { lte: monthEnd },
        pitstops: { some: { pitstopId: { in: pitstopIds } } },
      },
      select: { status: true, scheduledAt: true, pitstops: { select: { pitstopId: true } } },
    });
    for (const e of events) {
      // An event can link multiple pitstops; attribute to each owning goal once.
      const goalIds = new Set<string>();
      for (const link of e.pitstops) {
        const gid = pitstopToGoal.get(link.pitstopId);
        if (gid) goalIds.add(gid);
      }
      const inMonth = e.scheduledAt >= monthStart && e.scheduledAt <= monthEnd;
      const isToday = e.scheduledAt >= todayStart && e.scheduledAt <= todayEnd;
      const isOverdue = e.scheduledAt < todayStart && e.status !== "Done";
      for (const gid of goalIds) {
        const agg = totals.get(gid) ?? { done: 0, total: 0, overdue: 0, today: 0 };
        if (inMonth) { agg.total += 1; if (e.status === "Done") agg.done += 1; }
        if (isToday) agg.today += 1;
        if (isOverdue) agg.overdue += 1;
        totals.set(gid, agg);
      }
    }
  }

  const rows: CentreRow[] = goals.map((g) => {
    const t = totals.get(g.id) ?? { done: 0, total: 0, overdue: 0, today: 0 };
    return {
      goalId: g.id,
      name: g.linkedFacility?.name ?? g.title,
      mode: g.mode,
      cluster: g.linkedFacility?.cluster ?? g.needsCluster ?? null,
      settlement: g.linkedFacility?.settlement ?? g.needsSettlement ?? null,
      phase: deriveCentrePhase(g.pitstops as PhasePitstop[], { mode: g.mode }),
      month: { done: t.done, total: t.total },
      overdue: t.overdue,
      today: t.today,
    };
  });

  // Stable, useful order: setting-up first (by step), then live, then done;
  // alphabetical within each bucket.
  const rank = (r: CentreRow) => (r.phase.lifecycle === "setting_up" ? 0 : r.phase.lifecycle === "live" ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return rows;
}

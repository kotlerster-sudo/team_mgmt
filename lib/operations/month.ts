// Month-bucketing for the visit-driven operations model. The unit of discipline is the calendar
// month, not the day. IST-safe: uses local-time constructors (server runs IST), never iso.slice.

import prisma from "@/lib/prisma";
import type { Cadence } from "@/lib/catalogDb";

export type MonthBounds = { start: Date; end: Date };

/** First/last instant of the calendar month containing `d`. */
export function monthBounds(d: Date = new Date()): MonthBounds {
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Bounds of the month before the one containing `d`. */
export function prevMonthBounds(d: Date = new Date()): MonthBounds {
  return monthBounds(new Date(d.getFullYear(), d.getMonth() - 1, 15));
}

/** Number of ISO weeks a month touches (for week-cadence multiplication). */
function weeksInMonth(d: Date): number {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.ceil(daysInMonth / 7);
}

/** How many visits a cadence requires within the month containing `d`. */
export function requiredVisitsForMonth(cadence: Cadence | null, d: Date = new Date()): number {
  if (!cadence) return 0;
  if (cadence.period === "month") return cadence.count;
  return cadence.count * weeksInMonth(d); // week
}

/**
 * Count completed cadence VISITS for a set of goals within a month, grouped by goalId.
 *
 * A cadence visit is a parent Visit event (type=Visit, visitEventId=null) linked to the goal's
 * RECURRING (live "Operations") pitstop. The recurrence filter is what distinguishes a real visit
 * from a legacy site-visit *activity* that merely happens to be typed "Visit" on a setup pitstop.
 */
export async function doneVisitsByGoal(
  goalIds: string[],
  bounds: MonthBounds,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (goalIds.length === 0) return out;

  const rows = await prisma.pitstopEvent.findMany({
    where: {
      type: "Visit",
      visitEventId: null,
      status: "Done",
      deletedAt: null,
      completedAt: { gte: bounds.start, lte: bounds.end },
      pitstops: { some: { pitstop: { deletedAt: null, goalId: { in: goalIds }, recurrence: { not: "None" } } } },
    },
    select: { pitstops: { select: { pitstop: { select: { goalId: true, recurrence: true } } } } },
  });

  for (const r of rows) {
    // Count each event once per goal, only via its recurring-pitstop link.
    const goals = new Set<string>();
    for (const p of r.pitstops) {
      if (p.pitstop.recurrence !== "None" && goalIds.includes(p.pitstop.goalId)) goals.add(p.pitstop.goalId);
    }
    for (const gid of goals) out.set(gid, (out.get(gid) ?? 0) + 1);
  }
  return out;
}

/** "YYYY-MM" key for the month containing `d` (local time — server runs IST). */
export function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type VisitStats = {
  /** Completed cadence visits bucketed by "YYYY-MM". */
  byMonth: Map<string, number>;
  /** Most recent completed cadence visit inside the window (null if none). */
  lastVisitAt: Date | null;
};

/**
 * Multi-month sibling of `doneVisitsByGoal` — same cadence-visit discriminator
 * (parent Visit event, Done, linked to a RECURRING pitstop), but over an
 * arbitrary [from, to] window, bucketed per calendar month, plus the latest
 * completion per goal. One query feeds both the visit-compliance heatmap and
 * "last visited" — leaves `doneVisitsByGoal` untouched for the RP surfaces.
 */
export async function visitStatsByGoal(
  goalIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, VisitStats>> {
  const out = new Map<string, VisitStats>();
  if (goalIds.length === 0) return out;

  const rows = await prisma.pitstopEvent.findMany({
    where: {
      type: "Visit",
      visitEventId: null,
      status: "Done",
      deletedAt: null,
      completedAt: { gte: from, lte: to },
      pitstops: { some: { pitstop: { deletedAt: null, goalId: { in: goalIds }, recurrence: { not: "None" } } } },
    },
    select: {
      completedAt: true,
      pitstops: { select: { pitstop: { select: { goalId: true, recurrence: true } } } },
    },
  });

  const idSet = new Set(goalIds);
  for (const r of rows) {
    if (!r.completedAt) continue;
    const goals = new Set<string>();
    for (const p of r.pitstops) {
      if (p.pitstop.recurrence !== "None" && idSet.has(p.pitstop.goalId)) goals.add(p.pitstop.goalId);
    }
    const key = ymKey(r.completedAt);
    for (const gid of goals) {
      const stats = out.get(gid) ?? { byMonth: new Map<string, number>(), lastVisitAt: null };
      stats.byMonth.set(key, (stats.byMonth.get(key) ?? 0) + 1);
      if (!stats.lastVisitAt || r.completedAt > stats.lastVisitAt) stats.lastVisitAt = r.completedAt;
      out.set(gid, stats);
    }
  }
  return out;
}

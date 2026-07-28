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
 * Count completed VISITS (parent Visit events, not child ticks) for a set of goals within a month,
 * grouped by goalId. Parent visits are type=Visit with visitEventId = null.
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
      pitstops: { some: { pitstop: { deletedAt: null, goalId: { in: goalIds } } } },
    },
    select: { pitstops: { select: { pitstop: { select: { goalId: true } } } } },
  });

  for (const r of rows) {
    for (const p of r.pitstops) {
      const gid = p.pitstop.goalId;
      out.set(gid, (out.get(gid) ?? 0) + 1);
    }
  }
  return out;
}

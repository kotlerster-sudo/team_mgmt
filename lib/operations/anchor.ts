/**
 * The single canonical recurring "Operations" pitstop that anchors a LIVE centre's visit-driven
 * work — visits, materialised checklists, and cadence all hang off it.
 *
 * Why this exists: `-existing` centres often carry SEVERAL recurring pitstops (goal templates expand
 * recurring pitstops via repeatCount, + a since-fixed auto-clone bug), so "earliest recurring" is an
 * unstable, ambiguous anchor — visits scatter across pitstops, monthDone misses closed visits, and
 * currentVisit fails to resolve. We instead use exactly ONE dedicated pitstop titled "Operations"
 * (progressTag Monitoring, Monthly), created on go-live and never duplicated.
 */

import prisma from "@/lib/prisma";

export const OPERATIONS_PITSTOP_TITLE = "Operations";

/** The centre's Operations anchor id, or null if it doesn't have one yet. */
export async function resolveOperationsAnchorId(goalId: string): Promise<string | null> {
  const p = await prisma.pitstop.findFirst({
    where: { goalId, deletedAt: null, recurrence: { not: "None" }, title: OPERATIONS_PITSTOP_TITLE },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return p?.id ?? null;
}

/** The centre's Operations anchor id, creating the dedicated pitstop if it's missing. */
export async function resolveOrCreateOperationsAnchorId(goalId: string): Promise<string> {
  const existing = await resolveOperationsAnchorId(goalId);
  if (existing) return existing;

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { ownerId: true, needsSettlementId: true, needsClusterId: true, needsZoneId: true },
  });
  const maxOrder = await prisma.pitstop.aggregate({ where: { goalId, deletedAt: null }, _max: { order: true } });
  const now = new Date();
  const target = new Date(now);
  target.setMonth(target.getMonth() + 1);

  const created = await prisma.pitstop.create({
    data: {
      title: OPERATIONS_PITSTOP_TITLE,
      type: "Discussion",
      status: "InProgress",
      goalId,
      ownerId: goal?.ownerId ?? null,
      order: (maxOrder._max.order ?? 0) + 1,
      recurrence: "Monthly",
      progressTag: "Monitoring",
      startDate: now,
      targetDate: target,
      needsSettlementId: goal?.needsSettlementId ?? null,
      needsClusterId: goal?.needsClusterId ?? null,
      needsZoneId: goal?.needsZoneId ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Pick the anchor from an already-loaded list of a goal's recurring pitstops: the dedicated
 * "Operations" one if present, else the earliest (safe fallback for a not-yet-migrated centre).
 */
export function pickAnchor<T extends { id: string; title: string }>(recurringPitstops: T[]): T | null {
  if (recurringPitstops.length === 0) return null;
  return recurringPitstops.find((p) => p.title === OPERATIONS_PITSTOP_TITLE) ?? recurringPitstops[0];
}

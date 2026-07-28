/**
 * On-the-ground "today" loader for the Operations driver.
 *
 * Returns the person's overdue + today activities across ALL goal types, in the
 * exact `Activity` / `ChecklistItem` shape the reused ActivityCard consumes, so
 * completion (indicators + follow-ups + Done cascade) works unchanged. Grouping
 * (cluster → theme → centre) happens client-side from the activity's own goal
 * fields — no extra server work.
 */

import prisma from "@/lib/prisma";
import { eventOwnedByAnyOf, pitstopOwnedByAnyOf, goalOwnedByAnyOf } from "@/lib/ownership";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";
import { deriveCentrePhase, type CentrePhase, type PhasePitstop } from "./phase";

// Matches the home loader's event select so the shapes are identical.
export const EVENT_SELECT = {
  id: true,
  title: true,
  type: true,
  scheduledAt: true,
  location: true,
  status: true,
  displayDate: true,
  rescheduleCount: true,
  rescheduleReasonCode: true,
  attendees: { select: { user: { select: { id: true, name: true } } } },
  pitstops: {
    select: {
      pitstop: {
        select: {
          id: true,
          title: true,
          ownerId: true,
          goal: {
            select: {
              id: true,
              title: true,
              needsDomain: true,
              linkedFacilityId: true,
              needsCluster: { select: { id: true, name: true } },
              needsSettlement: { select: { id: true, name: true } },
              linkedFacility: { select: { name: true, cluster: { select: { id: true, name: true } } } },
              needsZone: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    take: 1,
  },
} as const;

export type TodayDriverData = {
  overdue: Activity[];
  today: Activity[];
  checklists: ChecklistItem[];
};

export async function loadTodayDriver(userIds: string[], now: Date = new Date()): Promise<TodayDriverData> {
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  // Not-pulled-into-today guard (mirrors home): exclude events whose displayDate
  // parks them on today from the overdue list.
  const notPulledIntoToday = {
    AND: [{
      OR: [
        { displayDate: null },
        { displayDate: { lt: todayStart } },
        { displayDate: { gt: todayEnd } },
      ],
    }],
  };

  const [today, overdue, checklists] = await Promise.all([
    prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        status: { not: "Cancelled" },
        AND: [{
          OR: [
            { scheduledAt: { gte: todayStart, lte: todayEnd } },
            { displayDate: { gte: todayStart, lte: todayEnd } },
          ],
        }],
        pitstops: { some: { pitstop: { deletedAt: null, goal: { deletedAt: null } } } },
        ...eventOwnedByAnyOf(userIds),
      },
      select: EVENT_SELECT,
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["Done", "Cancelled"] },
        scheduledAt: { lt: todayStart },
        ...notPulledIntoToday,
        pitstops: { some: { pitstop: { deletedAt: null, goal: { deletedAt: null } } } },
        ...eventOwnedByAnyOf(userIds),
      },
      select: EVENT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: 200,
    }),
    prisma.checklistItem.findMany({
      where: {
        status: { notIn: ["Done", "Cancelled"] },
        pitstop: { ...pitstopOwnedByAnyOf(userIds), deletedAt: null, goal: { deletedAt: null } },
      },
      select: {
        id: true, text: true, status: true, checked: true, completionType: true,
        activities: { select: { id: true, title: true, status: true, scheduledAt: true, type: true } },
        pitstop: {
          select: {
            id: true, title: true, targetDate: true, status: true, ownerId: true,
            owner: { select: { id: true, name: true } },
            goal: {
              select: {
                id: true, title: true, needsDomain: true, linkedFacilityId: true,
                needsCluster: { select: { id: true, name: true } },
                needsSettlement: { select: { id: true, name: true } },
                linkedFacility: { select: { name: true, cluster: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    today: today as unknown as Activity[],
    overdue: overdue as unknown as Activity[],
    checklists: checklists as unknown as ChecklistItem[],
  };
}

export type CentreFollowUp = {
  id: string;
  title: string;
  detail: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
};

export type CentreDetail = {
  goalId: string;
  name: string;
  cluster: { id: string; name: string } | null;
  needsDomain: string | null;
  phase: CentrePhase;
  activities: Activity[];
  checklists: ChecklistItem[];
  followUps: CentreFollowUp[];
};

/**
 * One centre's drill-down: its activities (overdue + today + near-future),
 * open checklists, and open follow-up action points. Scoped to `userIds` via
 * goal ownership; returns null when the goal isn't owned by / visible to them.
 */
export async function loadCentreDetail(
  userIds: string[],
  goalId: string,
  now: Date = new Date(),
): Promise<CentreDetail | null> {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null, ...goalOwnedByAnyOf(userIds) },
    select: {
      id: true, title: true, needsDomain: true,
      needsCluster: { select: { id: true, name: true } },
      linkedFacility: { select: { name: true, cluster: { select: { id: true, name: true } } } },
      pitstops: { where: { deletedAt: null }, select: { id: true, status: true, recurrence: true, order: true, progressTag: true, title: true } },
    },
  });
  if (!goal) return null;

  const horizon = new Date(now); horizon.setDate(horizon.getDate() + 60); horizon.setHours(23, 59, 59, 999);

  const [activities, checklists, followUps] = await Promise.all([
    prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        status: { not: "Cancelled" },
        scheduledAt: { lte: horizon },
        pitstops: { some: { pitstop: { goalId: goal.id, deletedAt: null } } },
      },
      select: EVENT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: 100,
    }),
    prisma.checklistItem.findMany({
      where: {
        status: { notIn: ["Done", "Cancelled"] },
        pitstop: { goalId: goal.id, deletedAt: null },
      },
      select: {
        id: true, text: true, status: true, checked: true, completionType: true,
        activities: { select: { id: true, title: true, status: true, scheduledAt: true, type: true } },
        pitstop: {
          select: {
            id: true, title: true, targetDate: true, status: true, ownerId: true,
            owner: { select: { id: true, name: true } },
            goal: {
              select: {
                id: true, title: true, needsDomain: true, linkedFacilityId: true,
                needsCluster: { select: { id: true, name: true } },
                needsSettlement: { select: { id: true, name: true } },
                linkedFacility: { select: { name: true, cluster: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.actionPoint.findMany({
      where: { goalId: goal.id, status: "open" },
      select: { id: true, title: true, detail: true, dueDate: true, priority: true, status: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  return {
    goalId: goal.id,
    name: goal.linkedFacility?.name ?? goal.title,
    cluster: goal.linkedFacility?.cluster ?? goal.needsCluster ?? null,
    needsDomain: goal.needsDomain,
    phase: deriveCentrePhase(goal.pitstops as PhasePitstop[]),
    activities: activities as unknown as Activity[],
    checklists: checklists as unknown as ChecklistItem[],
    followUps: followUps.map((f) => ({
      id: f.id, title: f.title, detail: f.detail, priority: f.priority, status: f.status,
      dueDate: f.dueDate ? f.dueDate.toISOString() : null,
    })),
  };
}

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { EVENT_SELECT } from "@/lib/operations/today";

/**
 * One WBS node's working detail for the plan side-sheet: the pitstop's checklist items (each with its
 * activities in the shared Activity shape so ActivityCard can complete them → indicators + follow-ups),
 * its open follow-ups, and its predecessor nodes. Read-only fetch; all mutations reuse existing routes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ pitstopId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { pitstopId } = await params;

  const pitstop = await prisma.pitstop.findFirst({
    where: { id: pitstopId, deletedAt: null },
    select: {
      id: true, title: true, status: true, progressTag: true, isMilestone: true, goalId: true,
      checklistItems: {
        where: { status: { not: "Cancelled" } },
        orderBy: { order: "asc" },
        select: {
          id: true, text: true, status: true, checked: true, completionType: true,
          activities: { where: { deletedAt: null }, select: EVENT_SELECT, orderBy: { scheduledAt: "asc" } },
        },
      },
      blockedBy: { select: { blockedBy: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!pitstop) return Response.json({ error: "Not found" }, { status: 404 });

  const followUps = await prisma.actionPoint.findMany({
    where: { pitstopId, status: "open" },
    select: { id: true, title: true, detail: true, dueDate: true, priority: true },
    orderBy: { dueDate: "asc" },
  });

  return Response.json({
    id: pitstop.id,
    goalId: pitstop.goalId,
    title: pitstop.title,
    status: pitstop.status,
    progressTag: pitstop.progressTag,
    isMilestone: pitstop.isMilestone,
    checklists: pitstop.checklistItems,
    followUps: followUps.map((f) => ({ ...f, dueDate: f.dueDate.toISOString() })),
    blockedBy: pitstop.blockedBy.map((d) => d.blockedBy),
  });
}

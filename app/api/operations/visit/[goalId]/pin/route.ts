import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { auditLog } from "@/lib/auditLog";

// Manager pins a visit to a specific day for a reportee (or themselves). Additive to the
// otherwise day-free month worklist: creates a Visit on the live centre with displayDate = the
// chosen day so it surfaces on that RP's Today. Reuses the planner's one-hop reportee visibility.
export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;
  const body = await req.json().catch(() => ({}));
  const assigneeId: string = body?.assigneeId ?? ctx.userId;
  const dateStr: string = body?.date ?? "";
  const day = dateStr ? new Date(`${dateStr}T09:00:00`) : null;
  if (!day || Number.isNaN(day.getTime())) {
    return Response.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
  }

  // Can only pin for yourself or someone in your visibility set.
  const allowed = new Set(await getVisibleUserIds(ctx));
  if (!allowed.has(assigneeId)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      title: true,
      mode: true,
      pitstops: { where: { deletedAt: null, recurrence: { not: "None" } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!goal || goal.mode !== "live" || goal.pitstops.length === 0) {
    return Response.json({ error: "Not a live centre" }, { status: 400 });
  }

  const visit = await prisma.pitstopEvent.create({
    data: {
      title: `Visit — ${goal.title}`,
      type: "Visit",
      status: "Scheduled",
      scheduledAt: day,
      originalScheduledAt: day,
      displayDate: day, // surfaces on the assignee's Today for the pinned day
      createdById: ctx.userId,
      lastUpdatedById: ctx.userId,
      pitstops: { create: [{ pitstopId: goal.pitstops[0].id }] },
      attendees: { create: [{ userId: assigneeId, status: "accepted" }] },
    },
    select: { id: true },
  });

  auditLog({
    entityType: "Activity", entityId: visit.id, userId: ctx.userId,
    action: "visit_pin", field: "assignee", newValue: `${assigneeId}@${dateStr}`,
  });

  return Response.json({ ok: true, visitId: visit.id });
}

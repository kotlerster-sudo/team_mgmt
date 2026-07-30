import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { viewerForbidden } from "@/lib/roleGuard";
import { auditLog } from "@/lib/auditLog";

export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { goalId } = await params;
  const { title, type, customType, notes, status, priority, startDate, targetDate, needsZoneId, needsClusterId, progressTag, isMilestone } = await req.json();
  if (!title) return Response.json({ error: "Title required" }, { status: 400 });

  const [goalRecord, existingCount] = await Promise.all([
    prisma.goal.findUnique({ where: { id: goalId }, select: { ownerId: true, targetDate: true } }),
    prisma.pitstop.count({ where: { goalId, deletedAt: null } }),
  ]);

  // Validate pitstop targetDate doesn't exceed goal's targetDate
  if (targetDate && goalRecord?.targetDate && new Date(targetDate) > goalRecord.targetDate) {
    return Response.json({ error: "Pitstop target date cannot be after the goal deadline" }, { status: 400 });
  }

  const [pitstop, goal] = await Promise.all([
    prisma.pitstop.create({
      data: {
        title, type: type ?? "Discussion", customType: type === "Custom" ? (customType?.trim() || null) : null,
        notes, status: status ?? "Upcoming", priority: priority ?? "Medium", goalId, order: existingCount,
        progressTag: progressTag || null,
        isMilestone: isMilestone === true,
        ownerId: goalRecord?.ownerId ?? null,
        startDate: startDate ? new Date(startDate) : undefined,
        targetDate: targetDate ? new Date(targetDate) : undefined,
        completedAt: status === "Done" ? new Date() : undefined,
        needsZoneId:    needsZoneId    ?? null,
        needsClusterId: needsClusterId ?? null,
      },
      include: {
        owner: { select: { id: true, name: true, image: true } },
        attachments: true,
        threads: { select: { id: true, name: true, _count: { select: { messages: true } } } },
        checklistItems: { select: { id: true, text: true, checked: true, completionType: true }, orderBy: { order: "asc" } },
      },
    }),
    prisma.goal.findUnique({
      where: { id: goalId },
      select: { title: true, followers: { select: { userId: true } } },
    }),
  ]);

  // Save custom type for reuse
  if (type === "Custom" && customType?.trim()) {
    await prisma.customPitstopType.upsert({
      where: { name: customType.trim() },
      create: { name: customType.trim() },
      update: {},
    });
  }

  auditLog({
    entityType: "Pitstop", entityId: pitstop.id, userId: session.user.id,
    action: "created", newValue: title,
  });

  // Pitstop owner auto-follows the goal
  if (pitstop.ownerId) {
    await prisma.goalFollow.upsert({
      where: { userId_goalId: { userId: pitstop.ownerId, goalId } },
      create: { userId: pitstop.ownerId, goalId },
      update: {},
    });
  }

  if (goal) {
    const link = `/goals/${goalId}/pitstops/${pitstop.id}`;
    const authorName = session.user.name ?? "Someone";
    const notifications = goal.followers
      .filter((f) => f.userId !== session.user.id)
      .map((f) => ({
        userId: f.userId,
        type: "NewPitstop" as const,
        title: `New pitstop in "${goal.title}"`,
        body: `${authorName} added "${title}"`,
        link,
      }));
    if (notifications.length > 0) {
      await prisma.notification.createMany({ data: notifications });
      const recipientIds = notifications.map((n) => n.userId);
      sendPushToUsers(recipientIds, { title: `New pitstop in "${goal.title}"`, body: `${authorName} added "${title}"`, link });
    }
  }

  return Response.json(pitstop, { status: 201 });
}

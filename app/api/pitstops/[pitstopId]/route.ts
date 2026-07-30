import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { viewerForbidden } from "@/lib/roleGuard";
import { auditLog } from "@/lib/auditLog";
import { cloneRecurringPitstopOnDone } from "@/lib/recurringPitstop";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ pitstopId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { pitstopId } = await params;
  const data = await req.json();

  // Validate targetDate against goal deadline
  if (data.targetDate) {
    const existing = await prisma.pitstop.findUnique({ where: { id: pitstopId }, select: { goal: { select: { targetDate: true } } } });
    if (existing?.goal?.targetDate && new Date(data.targetDate) > existing.goal.targetDate) {
      return Response.json({ error: "Pitstop target date cannot be after the goal deadline" }, { status: 400 });
    }
  }

  // Auto-set completedAt when status flips to Done
  const completedAt = data.status === "Done" ? (data.completedAt ?? new Date()) : data.status ? null : undefined;

  const existing = await prisma.pitstop.findUnique({
    where: { id: pitstopId },
    select: { recurrence: true, startDate: true, targetDate: true, status: true, goalId: true, order: true, priority: true, ownerId: true },
  });

  // Block manual Upcoming → InProgress: pitstops auto-advance when first checklist item is Done
  if (data.status === "InProgress" && existing?.status === "Upcoming") {
    return Response.json(
      { error: "Pitstops advance to In Progress automatically when field work begins (first checklist item completed)." },
      { status: 422 }
    );
  }

  const pitstop = await prisma.pitstop.update({
    where: { id: pitstopId },
    data: {
      title: data.title,
      type: data.type,
      customType: data.type === "Custom" ? (data.customType?.trim() || null) : data.type !== undefined ? null : undefined,
      notes: data.notes,
      status: data.status,
      recurrence: data.recurrence,
      ownerId: data.ownerId !== undefined ? (data.ownerId || null) : undefined,
      ownerInherited: data.ownerId !== undefined ? false : undefined,
      priority: data.priority ?? undefined,
      startDate: data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : undefined,
      targetDate: data.targetDate !== undefined ? (data.targetDate ? new Date(data.targetDate) : null) : undefined,
      completedAt: completedAt instanceof Date ? completedAt : completedAt === null ? null : undefined,
      // WBS plan: manual reorder within a workstream + milestone (gate) flag.
      order: typeof data.order === "number" ? data.order : undefined,
      isMilestone: typeof data.isMilestone === "boolean" ? data.isMilestone : undefined,
    },
    include: {
      attachments: true,
      threads: { select: { id: true, name: true, _count: { select: { messages: true } } } },
      checklistItems: { select: { id: true, text: true, checked: true, completionType: true }, orderBy: { order: "asc" } },
    },
  });

  // progressTag is a new column — update via raw SQL to bypass Prisma cache
  if (data.progressTag !== undefined) {
    const tagValue = data.progressTag || null;
    await prisma.$executeRaw`
      UPDATE "Pitstop" SET "progressTag" = ${tagValue}, "updatedAt" = NOW()
      WHERE id = ${pitstopId}
    `;
  }

  // Audit logging for changed fields
  if (existing) {
    const auditEntries: Array<{ entityType: string; entityId: string; userId: string; action: string; field: string; oldValue: string | null; newValue: string | null }> = [];
    const addAudit = (field: string, oldVal: string | null | undefined, newVal: string | null | undefined) => {
      if (newVal !== undefined && String(newVal ?? "") !== String(oldVal ?? "")) {
        auditEntries.push({
          entityType: "Pitstop",
          entityId: pitstopId,
          userId: session.user.id!,
          action: `${field}_change`,
          field,
          oldValue: oldVal ? String(oldVal) : null,
          newValue: newVal ? String(newVal) : null,
        });
      }
    };
    if (data.status !== undefined) addAudit("status", existing.status, data.status);
    if (data.priority !== undefined) addAudit("priority", existing.priority, data.priority);
    if (data.ownerId !== undefined) addAudit("ownerId", existing.ownerId, data.ownerId || null);
    if (data.targetDate !== undefined) addAudit("targetDate", existing.targetDate?.toISOString() ?? null, data.targetDate);
    if (data.startDate !== undefined) addAudit("startDate", existing.startDate?.toISOString() ?? null, data.startDate);
    if (auditEntries.length > 0) {
      await prisma.auditLog.createMany({ data: auditEntries });
    }

    // Variance log: record date changes with optional reason
    const dateChangeEntries: Array<{ id: string; pitstopId: string; field: string; oldDate: Date; newDate: Date; reason: string | null; changedById: string }> = [];
    if (data.targetDate !== undefined && existing.targetDate) {
      const newTargetDate = data.targetDate ? new Date(data.targetDate) : null;
      if (newTargetDate && newTargetDate.getTime() !== existing.targetDate.getTime()) {
        dateChangeEntries.push({
          id: crypto.randomUUID(),
          pitstopId,
          field: "targetDate",
          oldDate: existing.targetDate,
          newDate: newTargetDate,
          reason: data.reason ?? null,
          changedById: session.user.id!,
        });
      }
    }
    if (data.startDate !== undefined && existing.startDate) {
      const newStartDate = data.startDate ? new Date(data.startDate) : null;
      if (newStartDate && newStartDate.getTime() !== existing.startDate.getTime()) {
        dateChangeEntries.push({
          id: crypto.randomUUID(),
          pitstopId,
          field: "startDate",
          oldDate: existing.startDate,
          newDate: newStartDate,
          reason: data.reason ?? null,
          changedById: session.user.id!,
        });
      }
    }
    if (dateChangeEntries.length > 0) {
      await prisma.pitstopDateChange.createMany({ data: dateChangeEntries });
    }
  }

  // Save custom type for reuse
  if (data.type === "Custom" && data.customType?.trim()) {
    await prisma.customPitstopType.upsert({
      where: { name: data.customType.trim() },
      create: { name: data.customType.trim() },
      update: {},
    });
  }

  // New pitstop owner auto-follows the goal
  if (data.ownerId && pitstop.ownerId) {
    await prisma.goalFollow.upsert({
      where: { userId_goalId: { userId: pitstop.ownerId, goalId: pitstop.goalId } },
      create: { userId: pitstop.ownerId, goalId: pitstop.goalId },
      update: {},
    });
  }

  if (data.status === "Done" && existing?.status) {
    await cloneRecurringPitstopOnDone(pitstopId, existing.status);
  }

  // Notify goal followers when pitstop status changes
  if (data.status && existing?.status && data.status !== existing.status) {
    const goal = await prisma.goal.findUnique({
      where: { id: pitstop.goalId },
      select: { title: true, followers: { select: { userId: true } } },
    });
    if (goal) {
      const notifications = goal.followers
        .filter((f) => f.userId !== session.user.id)
        .map((f) => ({
          userId: f.userId,
          type: "PitstopStatusChange" as const,
          title: `"${pitstop.title}" is now ${data.status}`,
          body: `in ${goal.title}`,
          link: `/goals/${pitstop.goalId}/pitstops/${pitstopId}`,
        }));
      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
        sendPushToUsers(notifications.map((n) => n.userId), {
          title: notifications[0].title,
          body: notifications[0].body!,
          link: notifications[0].link!,
        });
      }
    }
  }

  return Response.json(pitstop);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ pitstopId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { pitstopId } = await params;
  const now = new Date();
  await prisma.$transaction([
    prisma.pitstop.update({ where: { id: pitstopId }, data: { deletedAt: now } }),
    // Cascade: soft-delete the pitstop's PitstopEvent rows so they stop
    // surfacing on RP/ZL/Leader Today tabs. Cover both linkage shapes —
    // many-to-many via PitstopEventPitstop, and the direct ChecklistItem
    // → PitstopEvent relation.
    prisma.pitstopEvent.updateMany({
      where: {
        deletedAt: null,
        OR: [
          { pitstops: { some: { pitstopId } } },
          { checklistItem: { pitstopId } },
        ],
      },
      data: { deletedAt: now },
    }),
  ]);
  auditLog({ entityType: "Pitstop", entityId: pitstopId, userId: session.user.id, action: "deleted" });
  return Response.json({ ok: true });
}

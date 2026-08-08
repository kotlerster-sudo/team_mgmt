/**
 * ActionPoint — edit + cancel.
 *
 *   PATCH  edit { title, detail, dueDate, priority, partnerStaffLabel, assigneeId }
 *   DELETE soft-cancel (sets status='cancelled'); reuses the AuditLog 'cancelled' action.
 *
 * Authorisation: per-record TEAM scope on `action_point.update` (for PATCH)
 * and OWN scope on `action_point.delete` (for cancel). Mirrors the rule that
 * supervisors can close/edit subordinate APs but not silently delete them.
 *
 * A task someone else handed you (assignedById set) is closeable but not
 * editable or cancellable by its owner — the terms of the ask stay with the
 * person who made it.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { viewerForbidden } from "@/lib/roleGuard";
import { buildRbacContext, scopeWhere, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { auditLog, diffAudit, auditLogMany } from "@/lib/auditLog";

/** True when the actor merely holds the task rather than having asked for it. */
function isDelegatedTo(
  ap: { ownerId: string; assignedById: string | null },
  actorId: string,
): boolean {
  return !!ap.assignedById && ap.assignedById !== actorId && ap.ownerId === actorId;
}

async function inScope(
  session: Awaited<ReturnType<typeof auth>>,
  req: Request,
  id: string,
  action: "update" | "delete",
): Promise<boolean> {
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return false;
  const where = await scopeWhere(ctx, "action_point", action);
  if (where === null) return false;
  const hit = await prisma.actionPoint.findFirst({
    where: { id, ...where },
    select: { id: true },
  });
  return hit !== null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { id } = await params;
  if (!(await inScope(session, req, id, "update"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorId = session.user.id;
  const body = await req.json();
  const { title, detail, dueDate, priority, partnerStaffLabel, assigneeId } = body ?? {};

  const before = await prisma.actionPoint.findUnique({
    where: { id },
    select: {
      title: true, detail: true, dueDate: true, priority: true, partnerStaffLabel: true,
      ownerId: true, assignedById: true,
    },
  });
  if (!before) return Response.json({ error: "Not found" }, { status: 404 });

  if (isDelegatedTo(before, actorId)) {
    return Response.json(
      { error: "This task was assigned to you — you can close it, but only the person who raised it can change it." },
      { status: 403 },
    );
  }

  const data: Record<string, unknown> = { lastUpdatedById: actorId };
  if (title !== undefined)              data.title = String(title).trim();
  if (detail !== undefined)             data.detail = detail ? String(detail).trim() : null;
  if (dueDate !== undefined)            data.dueDate = new Date(dueDate);
  if (priority !== undefined)           data.priority = priority === "urgent" ? "urgent" : "routine";
  if (partnerStaffLabel !== undefined)  data.partnerStaffLabel = partnerStaffLabel ? String(partnerStaffLabel).trim() : null;

  // Hand the task to someone else. Same authority as raising one: the action
  // grant plus the actor's own visibility set, so a ZL can move work between
  // their RPs but no further.
  if (assigneeId !== undefined) {
    const next = String(assigneeId).trim();
    if (!next) return Response.json({ error: "assigneeId cannot be empty" }, { status: 400 });
    if (next !== before.ownerId) {
      const ctx = await buildRbacContext(session, { req });
      if (!ctx || !(await can(ctx, "action_point", "assign"))) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const visible = new Set(await getVisibleUserIds(ctx));
      if (!visible.has(next)) return Response.json({ error: "Not in your team" }, { status: 403 });
      data.ownerId = next;
      data.assignedById = next === actorId ? null : actorId;
    }
  }

  const updated = await prisma.actionPoint.update({ where: { id }, data });

  // Field-diff audit — one row per actually-changed field.
  auditLogMany(diffAudit(
    "ActionPoint", id, actorId,
    before,
    {
      title: data.title, detail: data.detail, dueDate: data.dueDate,
      priority: data.priority, partnerStaffLabel: data.partnerStaffLabel,
      ownerId: data.ownerId,
    },
  ));

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { id } = await params;
  if (!(await inScope(session, req, id, "delete"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorId = session.user.id;
  const existing = await prisma.actionPoint.findUnique({
    where: { id },
    select: { ownerId: true, assignedById: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (isDelegatedTo(existing, actorId)) {
    return Response.json(
      { error: "This task was assigned to you — you can close it, but only the person who raised it can cancel it." },
      { status: 403 },
    );
  }

  await prisma.actionPoint.update({
    where: { id },
    data: { status: "cancelled", lastUpdatedById: actorId },
  });
  auditLog({ entityType: "ActionPoint", entityId: id, userId: actorId, action: "cancelled" });
  return Response.json({ ok: true });
}

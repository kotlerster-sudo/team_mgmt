import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";
import { loadVisitContext } from "@/lib/visits/context";
import { missingMandatory } from "@/lib/visits/completeness";

// Close a visit. Soft-warn: if mandatory (blocksSignoff) items are un-ticked and no reason is
// supplied, returns { needsReason, missing } WITHOUT closing. With a reason (or nothing missing),
// marks the Visit event Done — which counts toward the centre's monthly cadence.
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const actorId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const reason: string | null = body?.reason?.trim() || null;

  const ctx = await loadVisitContext(eventId);
  if (!ctx) return Response.json({ error: "Not a live-centre visit" }, { status: 400 });

  // A checklist counts as done THIS visit only when every activity under it (child events grouped by
  // their checklist) is Done. Those done-checklist keys == catalog item keys drive the mandatory check.
  const children = await prisma.pitstopEvent.findMany({
    where: { visitEventId: eventId, deletedAt: null, status: { not: "Cancelled" } },
    select: { status: true, checklistItem: { select: { key: true } } },
  });
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  for (const c of children) {
    const k = c.checklistItem?.key;
    if (!k) continue;
    total.set(k, (total.get(k) ?? 0) + 1);
    if (c.status === "Done") done.set(k, (done.get(k) ?? 0) + 1);
  }
  const ticked = [...total.keys()].filter((k) => (done.get(k) ?? 0) === total.get(k));

  const missing = missingMandatory(ctx.snapshot, ctx.overrides, ticked);

  if (missing.length > 0 && !reason) {
    return Response.json({ needsReason: true, missing }, { status: 200 });
  }

  await prisma.pitstopEvent.update({
    where: { id: eventId },
    data: {
      status: "Done",
      completedAt: new Date(),
      completedById: actorId,
      lastUpdatedById: actorId,
      ...(reason ? { cancellationReason: reason } : {}),
    },
  });

  auditLog({
    entityType: "Activity", entityId: eventId, userId: actorId,
    action: "visit_close", field: "status", newValue: reason ? `Done (reason: ${reason})` : "Done",
  });

  return Response.json({ ok: true, missing });
}

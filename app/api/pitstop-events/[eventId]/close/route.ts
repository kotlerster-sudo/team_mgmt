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

  // Keys ticked during THIS visit (child events grouped under it).
  const children = await prisma.pitstopEvent.findMany({
    where: { visitEventId: eventId, deletedAt: null, status: "Done" },
    select: { templateKey: true },
  });
  const ticked = children.map((c) => c.templateKey).filter((k): k is string => Boolean(k));

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

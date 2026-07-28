import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";

// "I have reached" — stamp arrival on a Visit event. Toggle off by posting { arrived: false }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const actorId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const arrived = body?.arrived !== false; // default true

  const event = await prisma.pitstopEvent.findFirst({
    where: { id: eventId, deletedAt: null },
    select: { id: true, arrivedAt: true },
  });
  if (!event) return Response.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.pitstopEvent.update({
    where: { id: eventId },
    data: arrived
      ? { arrivedAt: event.arrivedAt ?? new Date(), arrivedById: actorId, lastUpdatedById: actorId }
      : { arrivedAt: null, arrivedById: null, lastUpdatedById: actorId },
    select: { id: true, arrivedAt: true, arrivedById: true },
  });

  auditLog({
    entityType: "Activity", entityId: eventId, userId: actorId,
    action: "arrival", field: "arrivedAt", newValue: arrived ? "reached" : "cleared",
  });

  return Response.json(updated);
}

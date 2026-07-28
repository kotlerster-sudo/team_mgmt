import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";
import { autoAdvancePitstopFromItem } from "@/lib/autoAdvancePitstop";
import {
  captureIndicatorPointsForChecklistItem,
  captureJourneyOutcomePointsForChecklistItem,
} from "@/lib/captureIndicatorPoints";
import { loadVisitContext } from "@/lib/visits/context";
import { resolveEffectiveCatalog } from "@/lib/catalogDb";

// Tick one catalog item during a visit. Materialises the item as a ChecklistItem on the live
// pitstop (carrying templateSlug+key so indicator/journey capture keeps working) and records a
// Done child PitstopEvent grouped under the visit. Reuses the Done-path rollup semantics.
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const actorId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const itemKey: string = (body?.itemKey ?? "").trim();
  const values: Record<string, number> | undefined = body?.values;
  if (!itemKey) return Response.json({ error: "itemKey required" }, { status: 400 });

  const ctx = await loadVisitContext(eventId);
  if (!ctx) return Response.json({ error: "Not a live-centre visit" }, { status: 400 });

  // Resolve the item from the effective catalog (authoritative for text/completionType).
  const resolved = resolveEffectiveCatalog(ctx.snapshot, ctx.overrides).flatMap((c) => c.items);
  const item = resolved.find((i) => i.key === itemKey);
  if (!item) return Response.json({ error: "Unknown catalog item" }, { status: 404 });

  // 1. Find-or-create the ChecklistItem on the live pitstop (keyed by catalogSlug + itemKey).
  let checklist = await prisma.checklistItem.findFirst({
    where: { pitstopId: ctx.pitstopId, key: itemKey, templateSlug: ctx.catalogSlug },
    select: { id: true },
  });
  if (!checklist) {
    const maxOrder = await prisma.checklistItem.aggregate({
      where: { pitstopId: ctx.pitstopId },
      _max: { order: true },
    });
    checklist = await prisma.checklistItem.create({
      data: {
        pitstopId: ctx.pitstopId,
        text: item.text,
        order: (maxOrder._max.order ?? 0) + 1,
        key: itemKey,
        templateSlug: ctx.catalogSlug,
        ...(item.completionType && item.completionType !== "Activity"
          ? { completionType: item.completionType as "Voice" | "Upload" }
          : {}),
      },
      select: { id: true },
    });
  }
  const checklistItemId = checklist.id;

  // 2. Record the Done child event, grouped under the visit + linked to the live pitstop.
  const child = await prisma.pitstopEvent.create({
    data: {
      title: item.text,
      // "Event", not "Visit" — the parent is the Visit; children are the activities done on it,
      // so cadence counts (type=Visit, visitEventId null) don't double-count ticks.
      type: "Event",
      status: "Done",
      scheduledAt: ctx.scheduledAt,
      originalScheduledAt: ctx.scheduledAt,
      completedAt: new Date(),
      completedById: actorId,
      createdById: actorId,
      lastUpdatedById: actorId,
      checklistItemId,
      visitEventId: eventId,
      templateKey: itemKey,
      pitstops: { create: [{ pitstopId: ctx.pitstopId }] },
    },
    select: { id: true },
  });

  // 3. Roll the ChecklistItem up to Done when no sibling activities remain pending (Done-path rule).
  const pending = await prisma.pitstopEvent.count({
    where: {
      checklistItemId,
      deletedAt: null,
      id: { not: child.id },
      status: { in: ["Scheduled", "Rescheduled"] },
    },
  });
  if (pending === 0) {
    await prisma.checklistItem.update({
      where: { id: checklistItemId },
      data: {
        status: "Done",
        checked: true,
        completedAt: new Date(),
        completedById: actorId,
        lastUpdatedById: actorId,
      },
    });
    await autoAdvancePitstopFromItem(checklistItemId);
  }

  // 4. Optional indicator/journey capture (silent no-op when the item has no bindings).
  if (values && Object.keys(values).length > 0) {
    await captureIndicatorPointsForChecklistItem({ itemId: checklistItemId, values, capturedById: actorId });
    await captureJourneyOutcomePointsForChecklistItem({ itemId: checklistItemId, values, capturedById: actorId });
  }

  auditLog({
    entityType: "Activity", entityId: child.id, userId: actorId,
    action: "visit_tick", field: "itemKey", newValue: itemKey,
  });

  return Response.json({ ok: true, eventId: child.id, checklistItemId });
}

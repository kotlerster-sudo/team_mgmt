import prisma from "@/lib/prisma";
import { resolveEffectiveCatalog } from "@/lib/catalogDb";
import { loadVisitContext } from "./context";

/**
 * Materialise a visit's catalog into real, completable activities.
 *
 * For each item in the effective catalog, find-or-create (a) a ChecklistItem on the live pitstop
 * and (b) a *Scheduled* child PitstopEvent grouped under the visit. Completion then runs through
 * the standard flow (mark-done / voice / upload → CompleteActivityModal → indicators + follow-up),
 * exactly like any other activity — replacing the old single-click tick.
 *
 * Linked items (CatalogItem.ref) stamp the ChecklistItem with the goal-template's slug + checklist
 * key, so indicator / programme-journey bindings resolve. Legacy/ad-hoc items fall back to the
 * catalog slug + item key (no bindings). Idempotent: keyed by (visitEventId, templateKey=item.key).
 */
export async function materialiseVisitItems(visitEventId: string, actorId: string): Promise<void> {
  const ctx = await loadVisitContext(visitEventId);
  if (!ctx) return;

  const items = resolveEffectiveCatalog(ctx.snapshot, ctx.overrides).flatMap((c) => c.items);
  if (items.length === 0) return;

  const existing = await prisma.pitstopEvent.findMany({
    where: { visitEventId, deletedAt: null },
    select: { templateKey: true },
  });
  const have = new Set(existing.map((e) => e.templateKey).filter((k): k is string => Boolean(k)));

  for (const item of items) {
    if (have.has(item.key)) continue;

    // Linked → stamp the template's slug+key (fires indicator/journey bindings); else the catalog's.
    const stampSlug = item.ref?.templateSlug ?? ctx.catalogSlug;
    const stampKey = item.ref?.checklistKey ?? item.key;

    let checklist = await prisma.checklistItem.findFirst({
      where: { pitstopId: ctx.pitstopId, key: stampKey, templateSlug: stampSlug },
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
          key: stampKey,
          templateSlug: stampSlug,
          ...(item.completionType && item.completionType !== "Activity"
            ? { completionType: item.completionType as "Voice" | "Upload" }
            : {}),
        },
        select: { id: true },
      });
    }

    await prisma.pitstopEvent.create({
      data: {
        title: item.text,
        type: "Event",
        status: "Scheduled",
        scheduledAt: ctx.scheduledAt,
        originalScheduledAt: ctx.scheduledAt,
        createdById: actorId,
        lastUpdatedById: actorId,
        checklistItemId: checklist.id,
        visitEventId,
        templateKey: item.key, // groups the event back to its catalog item / category
        pitstops: { create: [{ pitstopId: ctx.pitstopId }] },
      },
    });
    have.add(item.key);
  }
}

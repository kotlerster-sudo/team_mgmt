import prisma from "@/lib/prisma";
import { resolveEffectiveCatalog } from "@/lib/catalogDb";
import { loadVisitContext } from "./context";
import { loadTemplateChecklists, type TemplateActivity } from "./templateActivities";

/**
 * Materialise a visit's catalog into real, completable activities — CHECKLIST → its ACTIVITIES.
 *
 * Each tagged catalog item references a goal-template checklist item; that checklist item has one or
 * more activities (the real completion units, each with its own completionType). For every item we
 * find-or-create:
 *   - one ChecklistItem on the live pitstop (stamped with the template's slug+checklistKey so
 *     indicator/journey bindings resolve, or the catalog's for legacy items), and
 *   - one Scheduled child PitstopEvent per activity under it (templateKey = activity key), grouped
 *     under the visit. Checklist items with no explicit activities fall back to a single event == the
 *     checklist; legacy/ad-hoc free-text items (no ref) stay one event == the item.
 *
 * Completion then runs through the standard ActivityCard → CompleteActivityModal flow
 * (completionType branch + indicators + follow-up). Idempotent per (visitEventId, templateKey).
 */
export async function materialiseVisitItems(visitEventId: string, actorId: string): Promise<void> {
  const ctx = await loadVisitContext(visitEventId);
  if (!ctx) return;

  const items = resolveEffectiveCatalog(ctx.snapshot, ctx.overrides).flatMap((c) => c.items);
  if (items.length === 0) return;

  // Load each referenced template's checklist→activities map once.
  const templateSlugs = [...new Set(items.map((i) => i.ref?.templateSlug).filter((s): s is string => !!s))];
  const templates = new Map(await Promise.all(
    templateSlugs.map(async (slug) => [slug, await loadTemplateChecklists(slug)] as const),
  ));

  // Skip any checklist that already has child events under this visit — makes materialise idempotent
  // AND leaves pre-existing (legacy single-event) materialisations untouched, so no duplication.
  const existing = await prisma.pitstopEvent.findMany({
    where: { visitEventId, deletedAt: null },
    select: { checklistItemId: true },
  });
  const checklistsWithEvents = new Set(existing.map((e) => e.checklistItemId).filter((id): id is string => Boolean(id)));

  for (const item of items) {
    const stampSlug = item.ref?.templateSlug ?? ctx.catalogSlug;
    const stampKey = item.ref?.checklistKey ?? item.key;

    // The activities to create under this checklist. Linked item → the template checklist's
    // activities; unlinked / no-activity → a single activity == the item itself.
    const tplChecklist = item.ref ? templates.get(item.ref.templateSlug)?.get(item.ref.checklistKey) : undefined;
    const activities: TemplateActivity[] =
      tplChecklist && tplChecklist.activities.length > 0
        ? tplChecklist.activities
        : [{ key: item.key, title: item.text, completionType: item.completionType || "Activity" }];

    // Find-or-create the shared ChecklistItem (carries indicator bindings + the completion type).
    const checklistCt = tplChecklist?.completionType || item.completionType || "Activity";
    let checklist = await prisma.checklistItem.findFirst({
      where: { pitstopId: ctx.pitstopId, key: stampKey, templateSlug: stampSlug },
      select: { id: true },
    });
    if (!checklist) {
      const maxOrder = await prisma.checklistItem.aggregate({ where: { pitstopId: ctx.pitstopId }, _max: { order: true } });
      checklist = await prisma.checklistItem.create({
        data: {
          pitstopId: ctx.pitstopId,
          text: tplChecklist?.text ?? item.text,
          order: (maxOrder._max.order ?? 0) + 1,
          key: stampKey,
          templateSlug: stampSlug,
          ...(checklistCt && checklistCt !== "Activity" ? { completionType: checklistCt as "Voice" | "Upload" } : {}),
        },
        select: { id: true },
      });
    }

    // Already materialised (this run or a prior/legacy one) → don't add duplicate activities.
    if (checklistsWithEvents.has(checklist.id)) continue;
    checklistsWithEvents.add(checklist.id);

    // One Scheduled child event per activity, grouped under the visit + linked to the checklist.
    for (const act of activities) {
      await prisma.pitstopEvent.create({
        data: {
          title: act.title,
          type: "Event",
          status: "Scheduled",
          scheduledAt: ctx.scheduledAt,
          originalScheduledAt: ctx.scheduledAt,
          createdById: actorId,
          lastUpdatedById: actorId,
          checklistItemId: checklist.id,
          visitEventId,
          templateKey: act.key,
          pitstops: { create: [{ pitstopId: ctx.pitstopId }] },
        },
      });
    }
  }
}

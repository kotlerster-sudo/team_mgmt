/**
 * Batched indicator-binding *labels* for a set of ChecklistItems.
 *
 * The per-event endpoint at /api/pitstop-events/[eventId]/indicators resolves the
 * SAME facility + journey bindings one event at a time (for capture). Here we only
 * need the display labels, for many checklist items at once, so a supervisor's
 * read-only drill-down can show "captures: Children present, Meals served" without
 * a round-trip per activity. Keyed on each item's (templateSlug, key) — items with
 * no key/templateSlug simply have no bindings.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

export type IndicatorLabel = { label: string; color: string; kind: "facility" | "journey" };

export async function loadIndicatorLabelsForChecklistItems(
  itemIds: string[],
): Promise<Map<string, IndicatorLabel[]>> {
  const out = new Map<string, IndicatorLabel[]>();
  if (itemIds.length === 0) return out;
  const ids = Prisma.join(itemIds);

  // Facility indicator bindings on each item's (templateSlug, key).
  const facility = await prisma.$queryRaw<{ itemId: string; label: string; color: string }[]>`
    SELECT ci.id AS "itemId", d.label AS "label", d.color AS "color"
    FROM "ChecklistItem" ci
    JOIN "ActivityIndicatorBinding" b
      ON b."templateSlug" = ci."templateSlug" AND b."checklistKey" = ci.key
    JOIN "FacilityIndicatorDef" d ON d.id = b."defId"
    WHERE ci.id IN (${ids})
      AND ci.key IS NOT NULL AND ci."templateSlug" IS NOT NULL
      AND d."isActive" = true
    ORDER BY d."sortOrder", d.label
  `;

  // Journey outcomes bound to each item, scoped to the goal/pitstop's settlement.
  const journey = await prisma.$queryRaw<{ itemId: string; label: string }[]>`
    SELECT ci.id AS "itemId", o.label AS "label"
    FROM "ChecklistItem" ci
    JOIN "Pitstop" p ON p.id = ci."pitstopId"
    JOIN "Goal" g ON g.id = p."goalId"
    JOIN "ProgrammeJourney" j
      ON j."settlementId" = COALESCE(g."needsSettlementId", p."needsSettlementId")
    JOIN "ProgrammeJourneyOutcome" o
      ON o."journeyId" = j.id
     AND o."captureSource" = 'RP_ACTIVITY'
     AND o."isActive" = true
     AND o."bindingTemplateSlug" = ci."templateSlug"
     AND o."bindingChecklistKey" = ci.key
    WHERE ci.id IN (${ids})
      AND ci.key IS NOT NULL AND ci."templateSlug" IS NOT NULL
  `;

  const push = (itemId: string, label: IndicatorLabel) => {
    const list = out.get(itemId) ?? [];
    list.push(label);
    out.set(itemId, list);
  };
  for (const f of facility) push(f.itemId, { label: f.label, color: f.color, kind: "facility" });
  for (const j of journey) push(j.itemId, { label: j.label, color: "#6366f1", kind: "journey" });
  return out;
}

/**
 * Indicator bindings + capture for one PitstopEvent's parent checklist item.
 *
 *   GET  → list of bindings (facility + journey outcomes) for the activity's
 *          parent checklist item. Same shape as the per-pitstop endpoint at
 *          /api/pitstops/[pitstopId]/indicator-bindings but flattened to a
 *          single array because we only care about one item.
 *
 *   POST → write the values via the existing capture helpers (so we don't
 *          duplicate the upsert logic the pitstop-detail page uses through
 *          PATCH /api/checklist/[itemId]). Body: { values: Record<string, number> }.
 *
 * Used by CompleteActivityModal to surface indicators alongside the closure
 * note + follow-up action points block, so an RP marking Done from Today /
 * Activities also captures the numbers without having to navigate to the
 * pitstop detail page.
 *
 * Returns [] / no-op when the event has no checklistItemId or the parent
 * item has no bindings — completion is never blocked by indicator gaps.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { viewerForbidden } from "@/lib/roleGuard";
import {
  captureIndicatorPointsForChecklistItem,
  captureJourneyOutcomePointsForChecklistItem,
  type ChecklistAnswer,
  type ChecklistAnswers,
} from "@/lib/captureIndicatorPoints";

type ChecklistItemDef = {
  id: string;
  itemKey: string;
  text: string;
  category: string | null;
  nonNegotiable: boolean;
  naAllowed: boolean;
  sortOrder: number;
};

type ItemBinding = {
  kind: "facility" | "journey";
  bindingId: string;
  numericField: string;
  defId: string;
  defLabel: string;
  defUnit: string | null;
  defColor: string;
  journeyId?: string;
  journeyLabel?: string;
  // Present when the def carries a scored tick-list — the modal renders
  // per-item Yes/No(/N-A) buttons instead of a numeric input.
  checklistItems?: ChecklistItemDef[];
};

async function resolveChecklistItemId(eventId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ checklistItemId: string | null }[]>`
    SELECT "checklistItemId" FROM "PitstopEvent" WHERE id = ${eventId} LIMIT 1
  `;
  return rows[0]?.checklistItemId ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const checklistItemId = await resolveChecklistItemId(eventId);
  if (!checklistItemId) return Response.json([], { status: 200 });

  // Facility indicator bindings on this checklist item's (templateSlug, key).
  const facility = await prisma.$queryRaw<{
    bindingId: string; numericField: string;
    defId: string; defLabel: string; defUnit: string | null; defColor: string;
  }[]>`
    SELECT b.id AS "bindingId", b."numericField",
           d.id AS "defId", d.label AS "defLabel", d.unit AS "defUnit", d.color AS "defColor"
    FROM "ChecklistItem" ci
    JOIN "ActivityIndicatorBinding" b
      ON b."templateSlug" = ci."templateSlug" AND b."checklistKey" = ci.key
    JOIN "FacilityIndicatorDef" d ON d.id = b."defId"
    WHERE ci.id = ${checklistItemId}
      AND ci.key IS NOT NULL AND ci."templateSlug" IS NOT NULL
      AND d."isActive" = true
    ORDER BY d."sortOrder", d.label
  `;

  // Journey outcomes bound to this checklist item, scoped to the goal /
  // pitstop's settlement (matches the per-pitstop endpoint's join).
  const journey = await prisma.$queryRaw<{
    outcomeId: string; outcomeLabel: string; outcomeUnit: string | null;
    journeyId: string; journeyLabel: string;
  }[]>`
    SELECT o.id AS "outcomeId", o.label AS "outcomeLabel", o.unit AS "outcomeUnit",
           j.id AS "journeyId", j.label AS "journeyLabel"
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
    WHERE ci.id = ${checklistItemId}
      AND ci.key IS NOT NULL AND ci."templateSlug" IS NOT NULL
  `;

  // Scored tick-list items for any of the facility defs (creche 24-point
  // safety etc.) — grouped per def and attached to its binding below.
  const defIds = [...new Set(facility.map(f => f.defId))];
  const checklistByDef = new Map<string, ChecklistItemDef[]>();
  if (defIds.length > 0) {
    const items = await prisma.$queryRaw<(ChecklistItemDef & { defId: string })[]>`
      SELECT id, "defId", "itemKey", text, category, "nonNegotiable", "naAllowed", "sortOrder"
      FROM "IndicatorChecklistItemDef"
      WHERE "defId" = ANY(${defIds}) AND "isActive" = true
      ORDER BY "defId", "sortOrder", "createdAt"
    `;
    for (const it of items) {
      const { defId, ...rest } = it;
      const list = checklistByDef.get(defId) ?? [];
      list.push(rest);
      checklistByDef.set(defId, list);
    }
  }

  const result: ItemBinding[] = [
    ...facility.map(f => ({
      kind: "facility" as const,
      bindingId: f.bindingId, numericField: f.numericField,
      defId: f.defId, defLabel: f.defLabel, defUnit: f.defUnit, defColor: f.defColor,
      ...(checklistByDef.has(f.defId) ? { checklistItems: checklistByDef.get(f.defId) } : {}),
    })),
    ...journey.map(j => ({
      kind: "journey" as const,
      bindingId: j.outcomeId,
      numericField: `outcome_${j.outcomeId.slice(0, 8)}`,
      defId: j.outcomeId, defLabel: j.outcomeLabel, defUnit: j.outcomeUnit,
      defColor: "#6366f1",
      journeyId: j.journeyId, journeyLabel: j.journeyLabel,
    })),
  ];

  return Response.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;

  const { eventId } = await params;
  const body = await req.json().catch(() => ({}));
  const rawValues = body?.values;
  const rawAnswers = body?.answers;

  // Coerce to number, drop non-finite / empty entries — same defensiveness
  // captureIndicatorPointsForChecklistItem already has, but we strip here
  // so the helper sees a clean numeric record.
  const values: Record<string, number> = {};
  if (rawValues && typeof rawValues === "object") {
    for (const [k, v] of Object.entries(rawValues)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) values[k] = n;
    }
  }

  // Sanitize tick-list answers: { numericField: { itemDefId: "yes"|"no"|"na" } }.
  // The helper re-validates item ids against the def and recomputes the score.
  const answers: ChecklistAnswers = {};
  if (rawAnswers && typeof rawAnswers === "object") {
    for (const [field, perItem] of Object.entries(rawAnswers)) {
      if (!perItem || typeof perItem !== "object") continue;
      const clean: Record<string, ChecklistAnswer> = {};
      for (const [itemDefId, a] of Object.entries(perItem as Record<string, unknown>)) {
        if (a === "yes" || a === "no" || a === "na") clean[itemDefId] = a;
      }
      if (Object.keys(clean).length > 0) answers[field] = clean;
    }
  }

  if (Object.keys(values).length === 0 && Object.keys(answers).length === 0) {
    return Response.json({ ok: true, captured: 0 });
  }

  const checklistItemId = await resolveChecklistItemId(eventId);
  if (!checklistItemId) {
    // Event isn't tied to a checklist item — nothing to capture against.
    // Treat as no-op so the activity-mark-done flow doesn't fail.
    return Response.json({ ok: true, captured: 0 });
  }

  await captureIndicatorPointsForChecklistItem({
    itemId: checklistItemId,
    values,
    checklistAnswers: answers,
    capturedById: session.user.id,
  });
  await captureJourneyOutcomePointsForChecklistItem({
    itemId: checklistItemId,
    values,
    capturedById: session.user.id,
  });

  return Response.json({ ok: true, captured: Object.keys(values).length });
}

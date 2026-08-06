import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";

type ItemContext = {
  key: string | null;
  templateSlug: string | null;
  settlementId: string | null;
  /** The goal's linked facility, when it is a facility-managed centre. NULL = settlement-level. */
  facilityId: string | null;
};

type Binding = {
  id: string;
  defId: string;
  numericField: string;
};

export type ChecklistAnswer = "yes" | "no" | "na";
// numericField → (itemDefId → answer)
export type ChecklistAnswers = Record<string, Record<string, ChecklistAnswer>>;

/**
 * Writes FacilityIndicatorPoint rows for an RP_ACTIVITY capture.
 *
 * Looks up bindings for the checklist item via (templateSlug, key), and for
 * each binding whose numericField is present in `values`, upserts the per-
 * settlement FacilityIndicator and inserts a time-series point.
 *
 * When `checklistAnswers` carries per-item tick-list answers for a binding's
 * numericField (defs with IndicatorChecklistItemDef rows), the score is
 * recomputed server-side as count(yes) + count(na) — overriding any client
 * value — and the answers are persisted alongside the point.
 *
 * Silent on missing settlement / missing key / no bindings — completion
 * is never blocked by indicator capture failures.
 */
export async function captureIndicatorPointsForChecklistItem({
  itemId,
  values,
  checklistAnswers,
  capturedById,
}: {
  itemId: string;
  values: Record<string, number>;
  checklistAnswers?: ChecklistAnswers;
  capturedById: string | null;
}) {
  const hasAnswers =
    !!checklistAnswers && Object.values(checklistAnswers).some(a => a && Object.keys(a).length > 0);
  if ((!values || Object.keys(values).length === 0) && !hasAnswers) return;

  const ctxRows = await prisma.$queryRaw<ItemContext[]>`
    SELECT
      ci.key,
      ci."templateSlug",
      -- Facility-linked centres carry their settlement on the LayerFeature, not
      -- needsSettlementId — fall back to it so those captures aren't dropped.
      COALESCE(g."needsSettlementId", p."needsSettlementId", lf."settlementId") AS "settlementId",
      g."linkedFacilityId" AS "facilityId"
    FROM "ChecklistItem" ci
    JOIN "Pitstop" p ON p.id = ci."pitstopId"
    JOIN "Goal" g ON g.id = p."goalId"
    LEFT JOIN "LayerFeature" lf ON lf.id = g."linkedFacilityId"
    WHERE ci.id = ${itemId}
    LIMIT 1
  `;
  const ctx = ctxRows[0];
  if (!ctx?.key || !ctx?.templateSlug || !ctx?.settlementId) return;

  const bindings = await prisma.$queryRaw<Binding[]>`
    SELECT b.id, b."defId", b."numericField"
    FROM "ActivityIndicatorBinding" b
    JOIN "FacilityIndicatorDef" d ON d.id = b."defId"
    WHERE b."templateSlug" = ${ctx.templateSlug}
      AND b."checklistKey" = ${ctx.key}
      AND d."isActive" = true
  `;

  for (const b of bindings) {
    let raw = values[b.numericField];
    let note: string | null = null;
    // Sanitized (itemDefId → answer) pairs to persist alongside the point.
    let answerRows: { itemDefId: string; answer: ChecklistAnswer }[] = [];

    // Tick-list path: recompute the score server-side from per-item answers.
    const rawAnswers = checklistAnswers?.[b.numericField];
    if (rawAnswers && Object.keys(rawAnswers).length > 0) {
      const items = await prisma.$queryRaw<{ id: string; nonNegotiable: boolean }[]>`
        SELECT id, "nonNegotiable" FROM "IndicatorChecklistItemDef"
        WHERE "defId" = ${b.defId} AND "isActive" = true
      `;
      const itemById = new Map(items.map(i => [i.id, i]));
      answerRows = Object.entries(rawAnswers)
        .filter(([itemDefId, a]) => itemById.has(itemDefId) && (a === "yes" || a === "no" || a === "na"))
        .map(([itemDefId, a]) => ({ itemDefId, answer: a }));
      if (answerRows.length > 0) {
        const score = answerRows.filter(a => a.answer !== "no").length;
        const nnFailing = answerRows.filter(
          a => a.answer === "no" && itemById.get(a.itemDefId)?.nonNegotiable
        ).length;
        raw = score;
        note = `${score}/${answerRows.length}${nnFailing > 0 ? ` · ${nnFailing} non-negotiable failing` : ""}`;
      }
    }

    if (raw === undefined || raw === null || !isFinite(raw)) continue;

    // Per-facility grain: the row is keyed by (def, settlement, facility) with a
    // NULL facility for settlement-level captures. `IS NOT DISTINCT FROM` matches
    // NULL=NULL, so find-then-write is used instead of ON CONFLICT (whose NULL
    // handling around the partial unique index is awkward).
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "FacilityIndicator"
      WHERE "defId" = ${b.defId}
        AND "settlementId" = ${ctx.settlementId}
        AND "facilityId" IS NOT DISTINCT FROM ${ctx.facilityId}
      LIMIT 1
    `;
    let resolvedIndicatorId: string;
    if (existing[0]) {
      resolvedIndicatorId = existing[0].id;
      await prisma.$executeRaw`
        UPDATE "FacilityIndicator"
        SET "currentValue" = ${raw}, "lastCapturedAt" = NOW(),
            "lastSource" = 'RP_ACTIVITY'::"FacilityIndicatorSource", "updatedAt" = NOW()
        WHERE id = ${resolvedIndicatorId}
      `;
    } else {
      resolvedIndicatorId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "FacilityIndicator" (
          id, "defId", "settlementId", "facilityId", "currentValue",
          "lastCapturedAt", "lastSource", "createdAt", "updatedAt"
        ) VALUES (
          ${resolvedIndicatorId}, ${b.defId}, ${ctx.settlementId}, ${ctx.facilityId}, ${raw},
          NOW(), 'RP_ACTIVITY'::"FacilityIndicatorSource", NOW(), NOW()
        )
      `;
    }

    const pointId = randomUUID();
    const pointInsert = prisma.$executeRaw`
      INSERT INTO "FacilityIndicatorPoint" (
        id, "indicatorId", value, "capturedAt", source,
        "sourceRefId", note, "capturedById", "createdAt"
      ) VALUES (
        ${pointId}, ${resolvedIndicatorId}, ${raw},
        NOW(), 'RP_ACTIVITY'::"FacilityIndicatorSource",
        ${itemId}, ${note}, ${capturedById}, NOW()
      )
    `;
    if (answerRows.length > 0) {
      await prisma.$transaction([
        pointInsert,
        ...answerRows.map(
          a => prisma.$executeRaw`
            INSERT INTO "IndicatorPointAnswer" (id, "pointId", "itemDefId", answer, "createdAt")
            VALUES (${randomUUID()}, ${pointId}, ${a.itemDefId}, ${a.answer}, NOW())
          `
        ),
      ]);
    } else {
      await pointInsert;
    }
  }
}

/**
 * Writes ProgrammeJourneyOutcomePoint rows for RP_ACTIVITY outcomes whose
 * (bindingTemplateSlug, bindingChecklistKey) match this checklist item AND
 * whose journey covers this settlement.
 */
export async function captureJourneyOutcomePointsForChecklistItem({
  itemId,
  values,
  capturedById,
}: {
  itemId: string;
  values: Record<string, number>;
  capturedById: string | null;
}) {
  if (!values || Object.keys(values).length === 0) return;

  const ctxRows = await prisma.$queryRaw<ItemContext[]>`
    SELECT
      ci.key,
      ci."templateSlug",
      COALESCE(g."needsSettlementId", p."needsSettlementId") AS "settlementId"
    FROM "ChecklistItem" ci
    JOIN "Pitstop" p ON p.id = ci."pitstopId"
    JOIN "Goal" g ON g.id = p."goalId"
    WHERE ci.id = ${itemId}
    LIMIT 1
  `;
  const ctx = ctxRows[0];
  if (!ctx?.key || !ctx?.templateSlug || !ctx?.settlementId) return;

  // Each outcome's numericField key in the request body is `outcome_<outcomeId>`
  const outcomes = await prisma.$queryRaw<{ id: string; key: string }[]>`
    SELECT o.id, o.key
    FROM "ProgrammeJourneyOutcome" o
    JOIN "ProgrammeJourney" j ON j.id = o."journeyId"
    WHERE o."captureSource" = 'RP_ACTIVITY'
      AND o."isActive" = true
      AND o."bindingTemplateSlug" = ${ctx.templateSlug}
      AND o."bindingChecklistKey" = ${ctx.key}
      AND j."settlementId" = ${ctx.settlementId}
  `;

  for (const o of outcomes) {
    const field = `outcome_${o.id.slice(0, 8)}`;
    const raw = values[field];
    if (raw === undefined || raw === null || !isFinite(raw)) continue;

    await prisma.$executeRaw`
      INSERT INTO "ProgrammeJourneyOutcomePoint" (
        id, "outcomeId", value, "capturedAt", source,
        "capturedById", "sourceRefId", "createdAt"
      ) VALUES (
        ${randomUUID()}, ${o.id}, ${raw},
        NOW(), 'RP_ACTIVITY',
        ${capturedById}, ${itemId}, NOW()
      )
    `;
  }
}

/**
 * Writer for caregiver-practice observations captured on a creche visit.
 *
 * Resolves the creche (facility) + settlement + goal from the parent Visit
 * PitstopEvent (the same goal→facility→settlement resolution the indicator
 * writer uses), then persists one observation row per flagged practice.
 *
 * Append-only across visits (carry-forward derives from the latest row per
 * facility+practice), but idempotent WITHIN a visit: re-saving replaces this
 * visit's rows for the touched practices so the panel can be reopened/edited.
 */

import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import type { CaregiverPracticeStatus, CaregiverPracticeAction } from "@/app/generated/prisma/client";

export type ObservationInput = {
  practiceId: string;
  status: CaregiverPracticeStatus;
  remarks?: string | null;
  action?: CaregiverPracticeAction | null;
  photoUrl?: string | null;
};

type VisitContext = { goalId: string; facilityId: string | null; settlementId: string | null };

/** Resolve goal / facility / settlement from a parent Visit event. */
export async function resolveVisitContext(visitEventId: string): Promise<VisitContext | null> {
  const rows = await prisma.$queryRaw<VisitContext[]>`
    SELECT g.id AS "goalId",
           g."linkedFacilityId" AS "facilityId",
           COALESCE(g."needsSettlementId", lf."settlementId") AS "settlementId"
    FROM "PitstopEvent" pe
    JOIN "PitstopEventPitstop" pep ON pep."eventId" = pe.id
    JOIN "Pitstop" p ON p.id = pep."pitstopId"
    JOIN "Goal" g ON g.id = p."goalId"
    LEFT JOIN "LayerFeature" lf ON lf.id = g."linkedFacilityId"
    WHERE pe.id = ${visitEventId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function captureCaregiverPractices({
  visitEventId,
  capturedById,
  observations,
}: {
  visitEventId: string;
  capturedById: string;
  observations: ObservationInput[];
}): Promise<{ written: number }> {
  if (!observations.length) return { written: 0 };

  const ctx = await resolveVisitContext(visitEventId);
  // Observations require a facility (creche). Silent no-op otherwise — capture
  // never blocks a visit (mirrors captureIndicatorPoints' silent-on-missing).
  if (!ctx?.facilityId || !ctx.settlementId) return { written: 0 };

  // Guard against stale client: only accept active practices.
  const practiceIds = [...new Set(observations.map((o) => o.practiceId))];
  const valid = new Set(
    (await prisma.caregiverPractice.findMany({ where: { id: { in: practiceIds }, isActive: true }, select: { id: true } })).map((p) => p.id),
  );
  const rows = observations.filter((o) => valid.has(o.practiceId));
  if (!rows.length) return { written: 0 };

  const facilityId = ctx.facilityId;
  const settlementId = ctx.settlementId;
  const goalId = ctx.goalId;

  await prisma.$transaction([
    // Replace this visit's rows for the touched practices (edit-on-reopen).
    prisma.caregiverPracticeObservation.deleteMany({
      where: { visitEventId, practiceId: { in: rows.map((r) => r.practiceId) } },
    }),
    prisma.caregiverPracticeObservation.createMany({
      data: rows.map((r) => ({
        id: randomUUID(),
        practiceId: r.practiceId,
        facilityId,
        settlementId,
        goalId,
        visitEventId,
        status: r.status,
        remarks: r.remarks?.trim() || null,
        action: r.action ?? null,
        photoUrl: r.photoUrl?.trim() || null,
        capturedById,
      })),
    }),
  ]);

  return { written: rows.length };
}

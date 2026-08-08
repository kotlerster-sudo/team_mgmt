/**
 * Writer for caregiver-practice observations captured on a creche visit.
 *
 * Resolves the creche (facility) + settlement + goal + pitstop from the parent
 * Visit PitstopEvent, then upserts one observation row per touched practice
 * (unique on visitEventId+practiceId). Append-across-visits — carry-forward
 * derives from the latest row per facility+practice.
 *
 * Phase 2: when a flag's action = EscalateToSupervisor it raises a real
 * ActionPoint (the existing follow-up feature — owner = RP, ageing, close-out,
 * team accountability), linked 1:1 via observation.actionPointId. Un-escalating
 * cancels the open AP. Only "Escalate" creates an AP; every flag still carries
 * forward for the next-visit re-check regardless.
 */

import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";
import type { CaregiverPracticeStatus, CaregiverPracticeAction } from "@/app/generated/prisma/client";

export type ObservationInput = {
  practiceId: string;
  status: CaregiverPracticeStatus;
  remarks?: string | null;
  action?: CaregiverPracticeAction | null;
  photoUrl?: string | null;
};

type VisitContext = { goalId: string; pitstopId: string | null; facilityId: string | null; settlementId: string | null };

/** Days out the auto-raised follow-up is due (next monthly visit window). */
const FOLLOWUP_DUE_DAYS = 30;

/** Resolve goal / pitstop / facility / settlement from a parent Visit event. */
export async function resolveVisitContext(visitEventId: string): Promise<VisitContext | null> {
  const rows = await prisma.$queryRaw<VisitContext[]>`
    SELECT g.id AS "goalId",
           p.id AS "pitstopId",
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
}): Promise<{ written: number; escalated: number }> {
  if (!observations.length) return { written: 0, escalated: 0 };

  const ctx = await resolveVisitContext(visitEventId);
  // Observations require a facility (creche). Silent no-op otherwise — capture
  // never blocks a visit (mirrors captureIndicatorPoints' silent-on-missing).
  if (!ctx?.facilityId || !ctx.settlementId) return { written: 0, escalated: 0 };
  const { facilityId, settlementId, goalId, pitstopId } = ctx;

  // Guard against stale client: only accept active practices; grab labels for AP titles.
  const practiceIds = [...new Set(observations.map((o) => o.practiceId))];
  const practices = new Map(
    (await prisma.caregiverPractice.findMany({ where: { id: { in: practiceIds }, isActive: true }, select: { id: true, shortLabel: true } }))
      .map((p) => [p.id, p.shortLabel]),
  );
  const rows = observations.filter((o) => practices.has(o.practiceId));
  if (!rows.length) return { written: 0, escalated: 0 };

  const dueDate = new Date(Date.now() + FOLLOWUP_DUE_DAYS * 86_400_000);
  let escalated = 0;

  for (const r of rows) {
    const existing = await prisma.caregiverPracticeObservation.findUnique({
      where: { visitEventId_practiceId: { visitEventId, practiceId: r.practiceId } },
      select: { id: true, actionPointId: true },
    });
    const escalate = r.action === "EscalateToSupervisor";
    let actionPointId = existing?.actionPointId ?? null;

    // Reconcile the follow-up AP with the escalate flag.
    if (escalate && !actionPointId && pitstopId) {
      const ap = await prisma.actionPoint.create({
        data: {
          goalId,
          pitstopId,
          pitstopEventId: visitEventId,
          title: `Caregiver practice: ${practices.get(r.practiceId)}`,
          detail: r.remarks?.trim() || null,
          dueDate,
          priority: "urgent",
          ownerId: capturedById,
          createdById: capturedById,
          status: "open",
        },
        select: { id: true },
      });
      actionPointId = ap.id;
      escalated++;
      auditLog({ entityType: "ActionPoint", entityId: ap.id, userId: capturedById, action: "created", newValue: "caregiver-practice escalation" });
    } else if (!escalate && actionPointId) {
      // Un-escalated — cancel the open follow-up and unlink.
      await prisma.actionPoint.updateMany({ where: { id: actionPointId, status: "open" }, data: { status: "cancelled", lastUpdatedById: capturedById } });
      actionPointId = null;
    }

    await prisma.caregiverPracticeObservation.upsert({
      where: { visitEventId_practiceId: { visitEventId, practiceId: r.practiceId } },
      create: {
        practiceId: r.practiceId,
        facilityId,
        settlementId,
        goalId,
        visitEventId,
        status: r.status,
        remarks: r.remarks?.trim() || null,
        action: r.action ?? null,
        photoUrl: r.photoUrl?.trim() || null,
        actionPointId,
        capturedById,
      },
      update: {
        status: r.status,
        remarks: r.remarks?.trim() || null,
        action: r.action ?? null,
        photoUrl: r.photoUrl?.trim() || null,
        actionPointId,
        capturedById,
        capturedAt: new Date(),
      },
    });
  }

  return { written: rows.length, escalated };
}

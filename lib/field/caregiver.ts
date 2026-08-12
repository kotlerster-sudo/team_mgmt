// Caregiver-practice capture for a /field cadence visit — the FieldVisit sibling
// of lib/captureCaregiverPractices (which is keyed on a legacy Visit PitstopEvent).
// Resolves facility/settlement from the Goal, upserts on (fieldVisitId, practiceId),
// and raises/cancels an escalation follow-up (ActionPoint) exactly like the old path.
import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";
import type { ObservationInput } from "@/lib/captureCaregiverPractices";

const FOLLOWUP_DUE_DAYS = 30;

type Ctx = { goalId: string; facilityId: string | null; settlementId: string | null };

async function resolveFieldVisitContext(fieldVisitId: string): Promise<Ctx | null> {
  const v = await prisma.fieldVisit.findUnique({
    where: { id: fieldVisitId },
    select: {
      goalId: true,
      goal: { select: { linkedFacilityId: true, needsSettlementId: true, linkedFacility: { select: { settlementId: true } } } },
    },
  });
  if (!v) return null;
  return {
    goalId: v.goalId,
    facilityId: v.goal.linkedFacilityId,
    settlementId: v.goal.needsSettlementId ?? v.goal.linkedFacility?.settlementId ?? null,
  };
}

export async function captureFieldCaregiverPractices({
  fieldVisitId,
  capturedById,
  observations,
}: {
  fieldVisitId: string;
  capturedById: string;
  observations: ObservationInput[];
}): Promise<{ written: number; escalated: number }> {
  if (!observations.length) return { written: 0, escalated: 0 };
  const ctx = await resolveFieldVisitContext(fieldVisitId);
  if (!ctx?.facilityId || !ctx.settlementId) return { written: 0, escalated: 0 }; // silent no-op (mirrors legacy)
  const { facilityId, settlementId, goalId } = ctx;

  const practiceIds = [...new Set(observations.map((o) => o.practiceId))];
  const practices = new Map(
    (await prisma.caregiverPractice.findMany({ where: { id: { in: practiceIds }, isActive: true }, select: { id: true, shortLabel: true } })).map((p) => [p.id, p.shortLabel]),
  );
  const rows = observations.filter((o) => practices.has(o.practiceId));
  if (!rows.length) return { written: 0, escalated: 0 };

  const dueDate = new Date(Date.now() + FOLLOWUP_DUE_DAYS * 86_400_000);
  let escalated = 0;

  for (const r of rows) {
    const existing = await prisma.caregiverPracticeObservation.findUnique({
      where: { fieldVisitId_practiceId: { fieldVisitId, practiceId: r.practiceId } },
      select: { id: true, actionPointId: true },
    });
    const escalate = r.action === "EscalateToSupervisor";
    let actionPointId = existing?.actionPointId ?? null;

    if (escalate && !actionPointId) {
      const ap = await prisma.actionPoint.create({
        data: {
          goalId,
          source: "adhoc",
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
      auditLog({ entityType: "ActionPoint", entityId: ap.id, userId: capturedById, action: "created", newValue: "caregiver-practice escalation (/field)" });
    } else if (!escalate && actionPointId) {
      await prisma.actionPoint.updateMany({ where: { id: actionPointId, status: "open" }, data: { status: "cancelled", lastUpdatedById: capturedById } });
      actionPointId = null;
    }

    await prisma.caregiverPracticeObservation.upsert({
      where: { fieldVisitId_practiceId: { fieldVisitId, practiceId: r.practiceId } },
      create: { practiceId: r.practiceId, facilityId, settlementId, goalId, fieldVisitId, status: r.status, remarks: r.remarks?.trim() || null, action: r.action ?? null, photoUrl: r.photoUrl?.trim() || null, actionPointId, capturedById },
      update: { status: r.status, remarks: r.remarks?.trim() || null, action: r.action ?? null, photoUrl: r.photoUrl?.trim() || null, actionPointId, capturedById, capturedAt: new Date() },
    });
  }
  return { written: rows.length, escalated };
}

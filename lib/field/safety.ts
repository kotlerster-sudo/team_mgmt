// Auto-follow-up reconciliation for scored checklist forms (the creche 24-point
// safety audit). A failed NON-NEGOTIABLE item raises an urgent follow-up
// (ActionPoint); fixing it on a later save cancels that follow-up. Idempotent —
// the raised AP ids are tracked in the FieldVisitStep answers blob
// (answers.raised = { itemKey: actionPointId }), mirroring the caregiver-practice
// escalation reconciliation in lib/captureCaregiverPractices.
import prisma from "@/lib/prisma";
import { auditLog } from "@/lib/auditLog";

const FOLLOWUP_DUE_DAYS = 30;
type SafetyItem = { key: string; text: string; nonNegotiable?: boolean };

/**
 * Reconcile follow-ups for a scored step. Returns the new raised-map to persist
 * alongside the marks. Non-scored / no-non-negotiable schemas are a no-op.
 */
export async function reconcileScoredFollowups(opts: {
  goalId: string;
  formSchema: unknown;
  marks: Record<string, string>; // itemKey → "ok" | "fail" | "na"
  prevRaised: Record<string, string>; // itemKey → actionPointId
  userId: string;
}): Promise<{ raised: Record<string, string>; opened: number; closed: number }> {
  const schema = opts.formSchema as { scored?: boolean; items?: SafetyItem[] } | null;
  const items = schema?.items ?? [];
  const nonNeg = items.filter((it) => it.nonNegotiable);
  const raised = { ...opts.prevRaised };
  let opened = 0;
  let closed = 0;
  if (!schema?.scored || nonNeg.length === 0) return { raised, opened, closed };

  const due = new Date(Date.now() + FOLLOWUP_DUE_DAYS * 86_400_000);
  const goal = await prisma.goal.findUnique({
    where: { id: opts.goalId },
    select: { needsSettlementId: true, needsClusterId: true, needsZoneId: true, needsCityId: true },
  });

  for (const it of nonNeg) {
    const failed = opts.marks[it.key] === "fail";
    const existingApId = raised[it.key];
    if (failed && !existingApId) {
      const ap = await prisma.actionPoint.create({
        data: {
          goalId: opts.goalId,
          source: "adhoc",
          title: `Safety (non-negotiable): ${it.text}`,
          dueDate: due,
          priority: "urgent",
          ownerId: opts.userId,
          createdById: opts.userId,
          status: "open",
          needsSettlementId: goal?.needsSettlementId ?? null,
          needsClusterId: goal?.needsClusterId ?? null,
          needsZoneId: goal?.needsZoneId ?? null,
          needsCityId: goal?.needsCityId ?? null,
        },
        select: { id: true },
      });
      raised[it.key] = ap.id;
      opened++;
      auditLog({ entityType: "ActionPoint", entityId: ap.id, userId: opts.userId, action: "created", newValue: "safety non-negotiable failure (/field)" });
    } else if (!failed && existingApId) {
      await prisma.actionPoint.updateMany({ where: { id: existingApId, status: "open" }, data: { status: "cancelled", lastUpdatedById: opts.userId } });
      delete raised[it.key];
      closed++;
    }
  }
  return { raised, opened, closed };
}

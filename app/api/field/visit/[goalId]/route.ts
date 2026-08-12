// Drive a live intervention's cadence visit.
//   POST { action: "open" }                            → start (or reuse) the open visit
//   POST { action: "arrive" }                          → stamp "I have reached"
//   POST { action: "tick", stepId, done, answers? }    → tick one recipe step
//   POST { action: "close", note? }                    → sign the visit off
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { assertFieldGoalAccess } from "@/lib/field/access";
import { reconcileScoredFollowups } from "@/lib/field/safety";

export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;
  if (!(await assertFieldGoalAccess(userId, goalId))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action: string = body?.action ?? "";
  const now = new Date();

  async function openVisit() {
    return prisma.fieldVisit.findFirst({ where: { goalId, closedAt: null }, orderBy: { createdAt: "desc" } });
  }

  switch (action) {
    case "open": {
      const existing = await openVisit();
      if (existing) return Response.json({ ok: true, visitId: existing.id });
      const v = await prisma.fieldVisit.create({ data: { goalId, scheduledFor: now } });
      return Response.json({ ok: true, visitId: v.id });
    }
    case "arrive": {
      const v = await openVisit();
      if (!v) return Response.json({ error: "No open visit" }, { status: 400 });
      await prisma.fieldVisit.update({ where: { id: v.id }, data: { arrivedAt: v.arrivedAt ?? now, arrivedById: v.arrivedById ?? userId } });
      return Response.json({ ok: true, visitId: v.id });
    }
    case "tick": {
      const v = await openVisit();
      if (!v) return Response.json({ error: "No open visit" }, { status: 400 });
      const stepId: string = body?.stepId ?? "";
      const done: boolean = !!body?.done;
      const step = await prisma.fieldStep.findFirst({ where: { id: stepId, goalId, kind: "Visit", deletedAt: null }, select: { id: true, formSchema: true } });
      if (!step) return Response.json({ error: "Unknown step" }, { status: 400 });

      // Scored checklist (e.g. 24-point safety): reconcile follow-ups for failed
      // non-negotiables and persist { marks, raised } so re-saves stay idempotent.
      let answers = body.answers ?? undefined;
      let followupResult: { opened: number; closed: number } | undefined;
      const marks = answers?.marks as Record<string, string> | undefined;
      if (marks) {
        const prev = await prisma.fieldVisitStep.findUnique({ where: { visitId_stepId: { visitId: v.id, stepId } }, select: { answers: true } });
        const prevRaised = ((prev?.answers as { raised?: Record<string, string> } | null)?.raised) ?? {};
        const { raised, opened, closed } = await reconcileScoredFollowups({ goalId, formSchema: step.formSchema, marks, prevRaised, userId });
        answers = { marks, raised };
        followupResult = { opened, closed };
      }

      await prisma.fieldVisitStep.upsert({
        where: { visitId_stepId: { visitId: v.id, stepId } },
        create: { visitId: v.id, stepId, status: done ? "Done" : "Todo", answers, completedById: done ? userId : null, completedAt: done ? now : null },
        update: { status: done ? "Done" : "Todo", answers, completedById: done ? userId : null, completedAt: done ? now : null },
      });
      return Response.json({ ok: true, visitId: v.id, followups: followupResult });
    }
    case "close": {
      const v = await openVisit();
      if (!v) return Response.json({ error: "No open visit" }, { status: 400 });
      await prisma.fieldVisit.update({ where: { id: v.id }, data: { closedAt: now, closedById: userId, note: body?.note ?? null } });
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

// Update one SETUP step of a /field intervention.
//   POST { action: "complete" | "reopen" | "skip" | "save", answers?: object }
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { assertFieldGoalAccess } from "@/lib/field/access";

export async function POST(req: NextRequest, { params }: { params: Promise<{ stepId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { stepId } = await params;
  const body = await req.json().catch(() => ({}));
  const action: string = body?.action ?? "";

  const step = await prisma.fieldStep.findFirst({ where: { id: stepId, kind: "Setup", deletedAt: null }, select: { id: true, goalId: true } });
  if (!step) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await assertFieldGoalAccess(userId, step.goalId))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const data: Record<string, unknown> = {};
  switch (action) {
    case "complete":
      data.status = "Done";
      data.completedAt = now;
      data.completedById = userId;
      if (body.answers !== undefined) data.answers = body.answers;
      break;
    case "reopen":
      data.status = "InProgress";
      data.completedAt = null;
      data.completedById = null;
      break;
    case "skip":
      data.status = "Skipped";
      data.completedAt = now;
      data.completedById = userId;
      break;
    case "save":
      data.answers = body.answers ?? {};
      if (body.markStarted) data.startedAt = now;
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  await prisma.fieldStep.update({ where: { id: stepId }, data });
  return Response.json({ ok: true });
}

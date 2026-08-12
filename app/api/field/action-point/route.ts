// Create a follow-up on a /field intervention. A lightweight ActionPoint
// (source "adhoc") owned by the caller, scoped to the goal + its geography.
//   POST { goalId, title, detail?, dueDate?: ISO, priority?: "routine"|"urgent" }
// Closing a follow-up reuses POST /api/action-points/[id]/complete.
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { assertFieldGoalAccess } from "@/lib/field/access";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const goalId: string = body?.goalId ?? "";
  const title: string = (body?.title ?? "").trim();
  if (!goalId || !title) return Response.json({ error: "goalId and title required" }, { status: 400 });
  if (!(await assertFieldGoalAccess(userId, goalId))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { needsSettlementId: true, needsClusterId: true, needsZoneId: true, needsCityId: true },
  });
  // dueDate is required on ActionPoint — default to +7 days (the old follow-up default).
  const picked = body?.dueDate ? new Date(body.dueDate) : null;
  const dueDate = picked && !Number.isNaN(picked.getTime()) ? picked : new Date(Date.now() + 7 * 864e5);

  const ap = await prisma.actionPoint.create({
    data: {
      title,
      detail: body?.detail ?? null,
      source: "adhoc",
      goalId,
      ownerId: userId,
      createdById: userId,
      dueDate,
      priority: body?.priority === "urgent" ? "urgent" : "routine",
      status: "open",
      needsSettlementId: goal?.needsSettlementId ?? null,
      needsClusterId: goal?.needsClusterId ?? null,
      needsZoneId: goal?.needsZoneId ?? null,
      needsCityId: goal?.needsCityId ?? null,
    },
    select: { id: true, title: true, detail: true, dueDate: true, priority: true },
  });
  return Response.json({ ok: true, followup: ap });
}

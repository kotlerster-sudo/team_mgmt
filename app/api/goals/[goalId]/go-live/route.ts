import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { setCentreLive } from "@/lib/operations/goLive";

// Flip a centre (Goal) to live/visit-driven mode. Gated on goal.update (any scope) —
// "anyone with rights", no ownership requirement.
export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;

  const goal = await prisma.goal.findUnique({ where: { id: goalId }, select: { id: true } });
  if (!goal) return Response.json({ error: "Not found" }, { status: 404 });

  if (!(await can(ctx, "goal", "update"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await setCentreLive(goalId);
    return Response.json(result);
  } catch (e) {
    console.error("[goals go-live] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Go-live failed: ${message}` }, { status: 500 });
  }
}

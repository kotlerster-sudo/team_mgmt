import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { setCentreLive } from "@/lib/operations/goLive";

// Flip a centre (Goal) to live/visit-driven mode. Admin or the goal owner/co-owner.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, ownerId: true, coOwners: { select: { userId: true } } },
  });
  if (!goal) return Response.json({ error: "Not found" }, { status: 404 });

  const uid = session.user.id;
  const allowed =
    isAdminUser(session) || goal.ownerId === uid || goal.coOwners.some((c) => c.userId === uid);
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await setCentreLive(goalId);
    return Response.json(result);
  } catch (e) {
    console.error("[goals go-live] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Go-live failed: ${message}` }, { status: 500 });
  }
}

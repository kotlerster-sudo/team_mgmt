import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { setCentreCadence } from "@/lib/operations/goLive";

// Update a live centre's visit cadence (per-centre override on its CentreCatalog).
// Gated on goal.update (any scope), matching go-live.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, select: { id: true } });
  if (!goal) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await can(ctx, "goal", "update"))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rawCount = body?.count;
  const rawPeriod = body?.period;
  const count = rawCount == null || rawCount === "" ? null : Number(rawCount);
  if (count != null && (!Number.isFinite(count) || count < 0)) {
    return Response.json({ error: "count must be a non-negative number" }, { status: 400 });
  }
  const period = rawPeriod === "week" || rawPeriod === "month" ? rawPeriod : null;

  try {
    await setCentreCadence(goalId, { count, period });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

// Re-tag an intervention's geography (and facility link).
//   PATCH { clusterId?, settlementId?, facilityId? }
// A settlement implies its cluster. Passing null clears a field.
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { goalId } = await params;
  const b = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (b.settlementId !== undefined) {
    data.needsSettlementId = b.settlementId || null;
    if (b.settlementId) {
      const s = await prisma.settlement.findUnique({ where: { id: b.settlementId }, select: { clusterId: true } });
      if (s?.clusterId) data.needsClusterId = s.clusterId;
    }
  }
  if (b.clusterId !== undefined && data.needsClusterId === undefined) data.needsClusterId = b.clusterId || null;
  if (b.facilityId !== undefined) data.linkedFacilityId = b.facilityId || null;

  await prisma.goal.update({ where: { id: goalId }, data });
  return Response.json({ ok: true });
}

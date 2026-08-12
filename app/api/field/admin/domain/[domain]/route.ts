// Edit a FieldDomainConfig (label / geo unit / cadence / overall SLA / live phase).
//   PATCH { label?, unit?, overallSlaDays?, cadenceCount?, cadencePeriod?, hasLivePhase?, isActive? }
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { domain } = await params;
  const b = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof b.label === "string") data.label = b.label;
  if (b.unit === "settlement" || b.unit === "cluster") data.unit = b.unit;
  if (b.cadencePeriod === "week" || b.cadencePeriod === "month" || b.cadencePeriod === null) data.cadencePeriod = b.cadencePeriod;
  if (b.overallSlaDays === null || Number.isFinite(b.overallSlaDays)) data.overallSlaDays = b.overallSlaDays;
  if (b.cadenceCount === null || Number.isFinite(b.cadenceCount)) data.cadenceCount = b.cadenceCount;
  if (typeof b.hasLivePhase === "boolean") data.hasLivePhase = b.hasLivePhase;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive;

  await prisma.fieldDomainConfig.update({ where: { domain }, data });
  return Response.json({ ok: true });
}

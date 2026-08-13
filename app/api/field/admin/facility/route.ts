// Create a facility (LayerFeature) so an intervention can be linked to one —
// e.g. a creche that has no facility record yet. POST { name, layerKey,
// clusterId?, settlementId?, centreType? }. A settlement implies its cluster.
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

export async function POST(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = String(b?.name ?? "").trim();
  const layerKey = String(b?.layerKey ?? "").trim();
  if (!name || !layerKey) return Response.json({ error: "name + layerKey required" }, { status: 400 });

  let clusterId: string | null = b?.clusterId || null;
  let zoneId: string | null = null;
  let lat = 0, lng = 0; // required on LayerFeature — default to the settlement's centroid.
  const settlementId: string | null = b?.settlementId || null;
  if (settlementId) {
    const s = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { clusterId: true, centroidLat: true, centroidLng: true, cluster: { select: { zoneId: true } } } });
    if (s?.clusterId) clusterId = s.clusterId;
    zoneId = s?.cluster?.zoneId ?? null;
    lat = s?.centroidLat ?? 0;
    lng = s?.centroidLng ?? 0;
  } else if (clusterId) {
    const c = await prisma.cluster.findUnique({ where: { id: clusterId }, select: { zoneId: true } });
    zoneId = c?.zoneId ?? null;
  }

  const f = await prisma.layerFeature.create({
    data: { name, layerKey, centreType: b?.centreType || null, settlementId, clusterId, zoneId, lat, lng },
    select: { id: true, name: true, settlementId: true },
  });
  return Response.json({ ok: true, facility: f });
}

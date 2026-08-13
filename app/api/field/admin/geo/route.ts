// Geo pickers for creating an intervention: settlements in a cluster, and
// facilities (LayerFeature) in that cluster for a given layer.
//   GET ?clusterId=…&layerKey=…
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

export async function GET(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const clusterId = url.searchParams.get("clusterId");
  const layerKey = url.searchParams.get("layerKey");
  if (!clusterId) return Response.json({ settlements: [], facilities: [] });

  const [settlements, facilities] = await Promise.all([
    prisma.settlement.findMany({ where: { clusterId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    layerKey
      ? prisma.layerFeature.findMany({ where: { clusterId, layerKey }, orderBy: { name: "asc" }, select: { id: true, name: true, settlementId: true } })
      : Promise.resolve([]),
  ]);
  return Response.json({ settlements, facilities });
}

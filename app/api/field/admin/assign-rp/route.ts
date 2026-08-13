// Set which clusters an RP is assigned to (User.rpClusters — drives the /field
// cluster list). POST { userId, clusterIds: string[] }
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

export async function POST(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const userId = String(b?.userId ?? "");
  const clusterIds: string[] = Array.isArray(b?.clusterIds) ? b.clusterIds : [];
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  await prisma.user.update({ where: { id: userId }, data: { rpClusters: { set: clusterIds.map((id) => ({ id })) } } });
  return Response.json({ ok: true });
}

// Cluster resolution for the cluster-first operations landing.
//
// The chooser shows the clusters a user actually works in: their assigned RP clusters
// (User.rpClusters) UNION the clusters their goals live in (directly via needsClusterId, or via
// the goal's settlement's cluster). This matches the whiteboard: "based on clusters assigned to
// this RP" + "goals created for this cluster or centres in this cluster".

import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { goalOwnedByAnyOf } from "@/lib/ownership";

export type ClusterOption = { id: string; name: string };

export async function getUserClusters(userIds: string[]): Promise<ClusterOption[]> {
  const [assigned, goals] = await Promise.all([
    prisma.cluster.findMany({
      where: { deletedAt: null, rps: { some: { id: { in: userIds } } } },
      select: { id: true, name: true },
    }),
    prisma.goal.findMany({
      where: { AND: [goalOwnedByAnyOf(userIds), { deletedAt: null }] },
      select: {
        needsCluster: { select: { id: true, name: true } },
        needsSettlement: { select: { cluster: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const byId = new Map<string, string>();
  for (const c of assigned) byId.set(c.id, c.name);
  for (const g of goals) {
    if (g.needsCluster) byId.set(g.needsCluster.id, g.needsCluster.name);
    const sc = g.needsSettlement?.cluster;
    if (sc) byId.set(sc.id, sc.name);
  }

  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Prisma Goal filter: goal is in this cluster directly OR via its settlement. */
export function goalInClusterFilter(clusterId: string): Prisma.GoalWhereInput {
  return {
    OR: [
      { needsClusterId: clusterId },
      { needsSettlement: { clusterId } },
    ],
  };
}

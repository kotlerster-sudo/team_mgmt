import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { buildRbacContext, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { getUserClusters, goalInClusterFilter } from "@/lib/operations/clusters";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

/**
 * Tasks — work that sits outside goal → pitstop → checklist → activity. Both
 * the ones you set yourself and the ones someone handed you, plus (for a
 * supervisor) what you've handed out.
 *
 * The pickers are assembled here rather than fetched, because each one is a
 * scope question the server already knows the answer to: who you may assign to
 * is `getVisibleUserIds`, the same predicate the API enforces on write.
 */
export default async function OperationsTasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session, { surface: "operations.tasks" });
  if (!ctx) redirect("/login");

  const userId = ctx.userId;
  const [visibleIds, clusters, mayAssign] = await Promise.all([
    getVisibleUserIds(ctx),
    getUserClusters([userId]),
    can(ctx, "action_point", "assign"),
  ]);

  const [people, cities, goals] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: visibleIds } },
      select: { id: true, name: true, image: true, designation: true },
    }),
    prisma.city.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    clusters.length
      ? prisma.goal.findMany({
          where: { deletedAt: null, OR: clusters.map((c) => goalInClusterFilter(c.id)) },
          select: { id: true, title: true, mode: true },
          orderBy: { title: "asc" },
          take: 300,
        })
      : Promise.resolve([]),
  ]);

  // Self first so the default assignee is stable; the rest by name.
  const sortedPeople = people.slice().sort((a, b) => {
    if (a.id === userId) return -1;
    if (b.id === userId) return 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return (
    <SurfaceProvider id="operations.tasks">
      <TasksClient
        currentUserId={userId}
        canAssignOthers={mayAssign && sortedPeople.length > 1}
        people={sortedPeople}
        clusters={clusters}
        cities={cities}
        goals={goals}
      />
    </SurfaceProvider>
  );
}

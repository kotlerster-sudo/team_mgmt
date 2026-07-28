import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Layers, ChevronLeft, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import {
  loadOversightTree, loadClusterBoard, loadPendingApprovals, loadOpenActionPoints,
} from "@/lib/operations/oversight";
import { ClusterList } from "../_shared/ClusterList";
import { ClusterBoard } from "../_shared/ClusterBoard";
import { ApprovalsPanel } from "../_shared/ApprovalsPanel";

export const dynamic = "force-dynamic";

/**
 * Supervisory oversight for ZL / PM / Leader. Two levels:
 *   - no ?cluster → cluster list (rollup chips) + the approval / follow-up queues.
 *   - ?cluster=<id> → that cluster's activity board: Today / Overdue / Upcoming / Happened,
 *     drilling into centre → activity.
 * Scope widens with role via getVisibleUserIds (ZL/PM one-hop, Leader/admin recursive).
 * RPs (self-only) are bounced to their own /operations home.
 */
export default async function OversightPage({
  searchParams,
}: {
  searchParams: Promise<{ cluster?: string }>;
}) {
  const { cluster: clusterId } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session);
  if (!ctx) redirect("/login");

  const visibleIds = await getVisibleUserIds(ctx);
  const isAdmin = ctx.role === "admin" || ctx.role === "super-admin";
  if (visibleIds.length <= 1 && !isAdmin) redirect("/operations");

  // ── Cluster board ──────────────────────────────────────────────────────────
  if (clusterId) {
    const board = await loadClusterBoard(visibleIds, clusterId);
    if (!board) notFound();
    return (
      <SurfaceProvider id="operations.oversight">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
          <div>
            <Link href="/operations/oversight" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
              <ChevronLeft className="w-3.5 h-3.5" /> All clusters
            </Link>
            <h1 className="text-lg font-semibold text-stone-900 mt-1 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-sky-600 shrink-0" /> {board.clusterName}
            </h1>
          </div>
          <ClusterBoard board={board} />
        </div>
      </SurfaceProvider>
    );
  }

  // ── Cluster list + queues ──────────────────────────────────────────────────
  const reportIds = visibleIds.filter((id) => id !== ctx.userId);
  const [tree, approvals, actionPoints] = await Promise.all([
    loadOversightTree(visibleIds),
    loadPendingApprovals(reportIds),
    loadOpenActionPoints(visibleIds),
  ]);
  const t = tree.totals;

  return (
    <SurfaceProvider id="operations.oversight">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        <header>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-600 shrink-0" />
            <h1 className="text-lg font-semibold text-stone-900">Oversight</h1>
          </div>
          <p className="text-sm text-stone-500 mt-0.5">
            {t.centres} centre{t.centres === 1 ? "" : "s"} across {t.rps} team member{t.rps === 1 ? "" : "s"}
            {" · "}
            <span className="text-emerald-600 font-medium">{t.live} live</span>
            {" · "}
            <span className="text-amber-600 font-medium">{t.settingUp} setting up</span>
          </p>
        </header>

        <ApprovalsPanel approvals={approvals} actionPoints={actionPoints} />

        {tree.zones.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
            No centres in your team yet.
          </div>
        ) : (
          <ClusterList zones={tree.zones} />
        )}
      </div>
    </SurfaceProvider>
  );
}

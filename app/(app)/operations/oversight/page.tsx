import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadOversightTree, loadPendingApprovals, loadOpenActionPoints } from "@/lib/operations/oversight";
import { OversightTree } from "../_shared/OversightTree";
import { ApprovalsPanel } from "../_shared/ApprovalsPanel";

export const dynamic = "force-dynamic";

/**
 * Supervisory oversight — geography-first drill-down for ZL / PM / Leader.
 * Zone → Cluster (live vs setting-up) → RP → Centre → activity (via the shared
 * read-only centre-detail leaf). Scope widens with role: ZL/PM see their one-hop
 * reports, Leader/admin the full recursive tree. RPs (self-only) are bounced back
 * to their own /operations home.
 */
export default async function OversightPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session);
  if (!ctx) redirect("/login");

  const visibleIds = await getVisibleUserIds(ctx);
  const isAdmin = ctx.role === "admin" || ctx.role === "super-admin";
  // Non-supervisors (RP / Other with no reports) have nothing to oversee.
  if (visibleIds.length <= 1 && !isAdmin) redirect("/operations");

  // Reports = the visible set minus the caller — the approve queue reviews reports' additions.
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
          <OversightTree zones={tree.zones} />
        )}
      </div>
    </SurfaceProvider>
  );
}

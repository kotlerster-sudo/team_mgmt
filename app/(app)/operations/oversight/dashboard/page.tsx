import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadClusterHealthDashboard, type ClusterHealth, type ClusterStatus } from "@/lib/operations/oversight";

export const dynamic = "force-dynamic";

/**
 * Cross-cluster health dashboard for ZL / PM / Leader — "where does each cluster stand".
 * One card per cluster: composite status (overdue load + cadence compliance + approval backlog),
 * live/setting-up counts, today/overdue/upcoming, cadence %, approvals. Each card drills into the
 * existing cluster board. Same gate as /operations/oversight (RPs are self-only → bounced).
 */
export default async function OversightDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const ctx = await buildRbacContext(session);
  if (!ctx) redirect("/login");

  const visibleIds = await getVisibleUserIds(ctx);
  const isAdmin = ctx.role === "admin" || ctx.role === "super-admin";
  if (visibleIds.length <= 1 && !isAdmin) redirect("/operations");

  const reportIds = visibleIds.filter((id) => id !== ctx.userId);
  const { zones, totals } = await loadClusterHealthDashboard(visibleIds, reportIds);

  return (
    <SurfaceProvider id="operations.dashboard">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        <header>
          <Link href="/operations/oversight" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
            <ChevronLeft className="w-3.5 h-3.5" /> Oversight
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <LayoutGrid className="w-4 h-4 text-sky-600 shrink-0" />
            <h1 className="text-lg font-semibold text-stone-900">Cluster dashboard</h1>
          </div>
          <p className="text-sm text-stone-500 mt-0.5">
            {totals.clusters} cluster{totals.clusters === 1 ? "" : "s"}
            {" · "}<span className="text-emerald-600 font-medium">{totals.live} live</span>
            {" · "}<span className="text-red-600 font-medium">{totals.overdue} overdue</span>
            {totals.pendingApprovals > 0 && <>{" · "}<span className="text-violet-600 font-medium">{totals.pendingApprovals} to approve</span></>}
          </p>
        </header>

        {zones.length === 0 || totals.clusters === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
            No clusters in your team yet.
          </div>
        ) : (
          zones.map((z) => (
            <section key={z.id} className="space-y-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{z.name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {z.clusters.map((c) => <ClusterCard key={c.id} c={c} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </SurfaceProvider>
  );
}

const STATUS_STYLE: Record<ClusterStatus, { dot: string; ring: string; label: string }> = {
  critical:  { dot: "bg-red-500",   ring: "border-red-200",   label: "Needs attention" },
  attention: { dot: "bg-amber-500", ring: "border-amber-200", label: "Watch" },
  healthy:   { dot: "bg-emerald-500", ring: "border-emerald-200", label: "On track" },
};

function ClusterCard({ c }: { c: ClusterHealth }) {
  const s = STATUS_STYLE[c.status];
  const cadencePct = c.cadenceRequired > 0 ? Math.round((c.cadenceDone / c.cadenceRequired) * 100) : null;
  return (
    <Link
      href={`/operations/oversight?cluster=${c.id}`}
      className={`group block rounded-xl border bg-white p-4 hover:shadow-sm transition-all ${s.ring}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-sm font-semibold text-stone-800 flex-1 min-w-0 truncate">{c.name}</span>
        <span className="text-[10px] font-medium text-stone-400">{s.label}</span>
        <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 shrink-0" />
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Chip tone="emerald">{c.live} live</Chip>
        {c.settingUp > 0 && <Chip tone="amber">{c.settingUp} setup</Chip>}
        {c.overdue > 0 && <Chip tone="red">{c.overdue} overdue</Chip>}
        {c.today > 0 && <Chip tone="sky">{c.today} today</Chip>}
        {c.pendingApprovals > 0 && <Chip tone="violet">{c.pendingApprovals} to approve</Chip>}
      </div>

      {cadencePct != null && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] text-stone-500 mb-1">
            <span>Visit cadence</span>
            <span className="tabular-nums font-medium">{c.cadenceDone}/{c.cadenceRequired} · {cadencePct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${cadencePct >= 70 ? "bg-emerald-400" : cadencePct >= 40 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${Math.min(100, cadencePct)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}

function Chip({ tone, children }: { tone: "red" | "sky" | "amber" | "emerald" | "violet"; children: React.ReactNode }) {
  const cls = {
    red: "text-red-700 bg-red-50 border-red-200",
    sky: "text-sky-700 bg-sky-50 border-sky-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    violet: "text-violet-700 bg-violet-50 border-violet-200",
  }[tone];
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

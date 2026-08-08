import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, CalendarRange, CheckCircle2, MapPin, ArrowLeftRight, Layers } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import prisma from "@/lib/prisma";
import { loadOperationsHome, type ThemeTile } from "@/lib/operations/home";
import { getUserClusters } from "@/lib/operations/clusters";
import { resolveViewContext, loadViewAsCandidates } from "@/lib/operations/viewAs";
import { PreviewBanner } from "./_shared/PreviewBanner";
import { ViewAsPicker } from "./_shared/ViewAsPicker";

export const dynamic = "force-dynamic";

/**
 * Operations world home — cluster-first. Step 0: choose the cluster you're visiting today. Step 1:
 * that cluster's programme (domain) tiles, shown three ways — Today, Overdue, and Overall — filtered
 * to the cluster. Tapping a tile opens that programme → a centre → its visit (live) or classic flow.
 */
export default async function OperationsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ asUser?: string; cluster?: string }>;
}) {
  const { asUser, cluster: clusterParam } = await searchParams;
  const ctx = await resolveViewContext(asUser);
  if (!ctx) redirect("/login");
  const userId = ctx.userId;
  const preview = ctx.viewingAs;

  const [clusters, me, candidates, openTasks] = await Promise.all([
    getUserClusters([userId]),
    prisma.user.findUnique({ where: { id: userId }, select: { designation: true } }),
    ctx.isAdmin && !preview ? loadViewAsCandidates() : Promise.resolve([]),
    prisma.actionPoint.count({ where: { ownerId: userId, source: "adhoc", status: "open" } }),
  ]);
  const selected = clusterParam ? clusters.find((c) => c.id === clusterParam) ?? null : null;

  // Supervisors get a shortcut to the oversight drill-down (also the only entry on mobile,
  // where the sidebar "Oversight" item isn't shown). Hidden in admin "view as" preview.
  const isSupervisor =
    !preview && (ctx.isAdmin || ["ZL", "PM", "Leader"].includes(me?.designation ?? ""));

  const asUserParam = preview ? `asUser=${encodeURIComponent(userId)}` : "";
  const withParams = (base: string, extra: string[] = []) => {
    const qs = [...extra, asUserParam].filter(Boolean).join("&");
    return `${base}${qs ? `?${qs}` : ""}`;
  };

  // ── Step 0: cluster chooser ────────────────────────────────────────────────
  if (!selected) {
    return (
      <SurfaceProvider id="operations.today">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
          {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}
          <header className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-stone-900">
                {preview ? "Operations" : "Where are you today?"}
              </h1>
              <p className="text-sm text-stone-500 mt-0.5">
                {preview
                  ? `${preview.name ?? "User"}'s clusters — pick one to preview.`
                  : "Pick the cluster you're visiting."}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isSupervisor && <OversightLink />}
              {ctx.isAdmin && !preview && candidates.length > 0 && <ViewAsPicker candidates={candidates} />}
            </div>
          </header>

          {clusters.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
              No clusters assigned yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {clusters.map((c) => (
                <Link
                  key={c.id}
                  href={withParams("/operations", [`cluster=${encodeURIComponent(c.id)}`])}
                  className="group flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 hover:shadow-sm transition-all"
                >
                  <span className="w-10 h-10 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-semibold text-stone-800 flex-1 truncate">{c.name}</span>
                  <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400" />
                </Link>
              ))}
            </div>
          )}

          {!preview && (
            <div className="space-y-3">
              <TasksLink count={openTasks} />
              <PlanMonthLink withParams={withParams} />
            </div>
          )}
        </div>
      </SurfaceProvider>
    );
  }

  // ── Step 1: cluster-scoped landing ─────────────────────────────────────────
  const tiles = await loadOperationsHome([userId], { clusterId: selected.id });

  const clusterQ = `cluster=${encodeURIComponent(selected.id)}`;
  const href = (key: string, lens?: "visit" | "overdue") =>
    withParams(`/operations/${encodeURIComponent(key)}`, [lens ? `lens=${lens}` : "", clusterQ].filter(Boolean));

  const needsVisitTiles = tiles.filter((t) => t.needsVisitCentres > 0).sort((a, b) => b.visitsToGo - a.visitsToGo);
  const missedTiles = tiles.filter((t) => t.missedVisits > 0).sort((a, b) => b.missedVisits - a.missedVisits);
  const whose = preview ? `${preview.name ?? "User"}'s` : "Your";

  return (
    <SurfaceProvider id="operations.today">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-7">
        {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}

        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-sky-600 shrink-0" />
              <h1 className="text-lg font-semibold text-stone-900 truncate">{selected.name}</h1>
            </div>
            <Link
              href={withParams("/operations")}
              className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 mt-1"
            >
              <ArrowLeftRight className="w-3 h-3" /> Change cluster
            </Link>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isSupervisor && <OversightLink />}
            {ctx.isAdmin && !preview && candidates.length > 0 && <ViewAsPicker candidates={candidates} />}
          </div>
        </header>

        <TileSection title="Needs a visit this month">
          {needsVisitTiles.length === 0 ? (
            <CaughtUp label="Every centre visited this month." />
          ) : (
            <TileGrid>
              {needsVisitTiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key, "visit")} tone="visit" />
              ))}
            </TileGrid>
          )}
        </TileSection>

        {missedTiles.length > 0 && (
          <TileSection title="Overdue · last month">
            <TileGrid>
              {missedTiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key, "overdue")} tone="overdue" />
              ))}
            </TileGrid>
          </TileSection>
        )}

        <TileSection title={`${whose} programmes in this cluster`}>
          {tiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
              No programmes in this cluster yet.
            </div>
          ) : (
            <TileGrid>
              {tiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key)} tone="overall" />
              ))}
            </TileGrid>
          )}
        </TileSection>
      </div>
    </SurfaceProvider>
  );
}

function TasksLink({ count }: { count: number }) {
  return (
    <Link
      href="/operations/tasks"
      className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-stone-400" />
        <span className="text-sm font-medium text-stone-700">Tasks</span>
      </div>
      <div className="flex items-center gap-1.5">
        {count > 0 && (
          <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 tabular-nums">
            {count} open
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-stone-300" />
      </div>
    </Link>
  );
}

function PlanMonthLink({ withParams }: { withParams: (base: string, extra?: string[]) => string }) {
  return (
    <Link
      href={withParams("/operations/plan")}
      className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 hover:bg-sky-100 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <CalendarRange className="w-4 h-4 text-sky-600" />
        <span className="text-sm font-medium text-sky-800">Plan your month</span>
      </div>
      <ChevronRight className="w-4 h-4 text-sky-400" />
    </Link>
  );
}

function OversightLink() {
  return (
    <Link
      href="/operations/oversight"
      className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-300 hover:text-stone-800 transition-colors"
    >
      <Layers className="w-3.5 h-3.5 text-sky-600" /> Oversight
    </Link>
  );
}

function TileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  );
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function CaughtUp({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      <span className="text-sm font-medium text-emerald-800">{label}</span>
    </div>
  );
}

function TileCard({
  tile, href, tone,
}: {
  tile: ThemeTile;
  href: string;
  tone: "visit" | "overdue" | "overall";
}) {
  const centres = (n: number) => `${n} centre${n === 1 ? "" : "s"}`;
  const visits = (n: number) => `${n} visit${n === 1 ? "" : "s"}`;
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 hover:shadow-sm transition-all"
    >
      <span
        className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
        style={{ backgroundColor: tile.theme.color }}
      >
        {tile.theme.label.slice(0, 1).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-800 truncate">{tile.theme.label}</p>
        <p className="text-xs text-stone-500 mt-0.5">
          {tone === "visit" && (
            <span className="text-sky-600 font-medium tabular-nums">
              {centres(tile.needsVisitCentres)} · {visits(tile.visitsToGo)} to go
            </span>
          )}
          {tone === "overdue" && (
            <span className="text-amber-600 font-medium tabular-nums">
              {visits(tile.missedVisits)} missed last month
            </span>
          )}
          {tone === "overall" && (
            <>
              {tile.settingUp > 0 && <span className="text-amber-600 font-medium">{tile.settingUp} setting up</span>}
              {tile.settingUp > 0 && tile.live > 0 && <span className="text-stone-300"> · </span>}
              {tile.live > 0 && (
                <span className="text-emerald-600 font-medium">
                  {tile.live} live{tile.monthRequired > 0 && <span className="text-stone-400 font-normal tabular-nums"> · {tile.monthDone}/{tile.monthRequired} visits</span>}
                </span>
              )}
              {tile.settingUp === 0 && tile.live === 0 && <span>{centres(tile.total)}</span>}
            </>
          )}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400" />
    </Link>
  );
}

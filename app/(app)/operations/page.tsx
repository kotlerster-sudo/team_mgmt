import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, CalendarRange, MapPin } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadOperationsHome } from "@/lib/operations/home";
import { loadTodayDriver } from "@/lib/operations/today";
import { resolveViewContext, loadViewAsCandidates } from "@/lib/operations/viewAs";
import { PreviewBanner } from "./_shared/PreviewBanner";
import { ViewAsPicker } from "./_shared/ViewAsPicker";
import { TodayDriver } from "./_shared/TodayDriver";
import type { Activity } from "@/app/(app)/home/_lib/types";

export const dynamic = "force-dynamic";

/**
 * Operations world home. Leads with where the person is working today, then the
 * theme tiles (each carrying an overdue count). Tapping a tile opens the
 * phase-aware theme portal → a centre → that centre's activities/follow-ups.
 * The month planner is always one tap away.
 */
export default async function OperationsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ asUser?: string }>;
}) {
  const { asUser } = await searchParams;
  const ctx = await resolveViewContext(asUser);
  if (!ctx) redirect("/login");
  const userId = ctx.userId;
  const preview = ctx.viewingAs;
  const themeQuery = preview ? `?asUser=${encodeURIComponent(userId)}` : "";

  const [tiles, driver, candidates] = await Promise.all([
    loadOperationsHome([userId]),
    loadTodayDriver([userId]),
    ctx.isAdmin && !preview ? loadViewAsCandidates() : Promise.resolve([]),
  ]);

  // "You're here today" = the distinct clusters of today's scheduled work.
  const todayClusters = distinctClusters(driver.today);
  // Overdue count per theme (by needsDomain) for the tile badges.
  const overdueByTheme = new Map<string, number>();
  for (const a of driver.overdue) {
    const dom = a.pitstops?.[0]?.pitstop?.goal?.needsDomain;
    if (dom) overdueByTheme.set(dom, (overdueByTheme.get(dom) ?? 0) + 1);
  }

  const whose = preview ? `${preview.name ?? "User"}'s` : "Your";

  return (
    <SurfaceProvider id="operations.today">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}

        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-stone-900">Operations</h1>
            {todayClusters.length > 0 ? (
              <p className="text-sm text-stone-600 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
                <span className="truncate">Today: {todayClusters.join(" · ")}</span>
              </p>
            ) : (
              <p className="text-sm text-stone-400 mt-0.5">No visits scheduled today.</p>
            )}
          </div>
          {ctx.isAdmin && !preview && candidates.length > 0 && <ViewAsPicker candidates={candidates} />}
        </header>

        {/* Today's driver — everything due today + overdue across all
            programmes, completable in place so no drill-in is needed. */}
        <TodayDriver
          today={driver.today}
          overdue={driver.overdue}
          checklists={driver.checklists}
          readOnly={!!preview}
          storageKey={`operations-today-${userId}`}
        />

        {/* Month planner — always available. */}
        {!preview && (
          <Link
            href="/operations/plan"
            className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 hover:bg-sky-100 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <CalendarRange className="w-4 h-4 text-sky-600" />
              <span className="text-sm font-medium text-sky-800">Plan your month</span>
            </div>
            <ChevronRight className="w-4 h-4 text-sky-400" />
          </Link>
        )}

        <section>
          <h2 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">
            {whose} programmes
          </h2>
          {tiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
              No programmes assigned yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tiles.map((t) => {
                const overdue = overdueByTheme.get(t.theme.key) ?? 0;
                return (
                  <Link
                    key={t.theme.key}
                    href={`/operations/${encodeURIComponent(t.theme.key)}${themeQuery}`}
                    className="group flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 hover:shadow-sm transition-all"
                  >
                    <span
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                      style={{ backgroundColor: t.theme.color }}
                    >
                      {t.theme.label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-stone-800 truncate">{t.theme.label}</p>
                        {overdue > 0 && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 tabular-nums flex-shrink-0">
                            {overdue} overdue
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {t.settingUp > 0 && <span className="text-amber-600 font-medium">{t.settingUp} setting up</span>}
                        {t.settingUp > 0 && t.live > 0 && <span className="text-stone-300"> · </span>}
                        {t.live > 0 && <span className="text-emerald-600 font-medium">{t.live} live</span>}
                        {t.settingUp === 0 && t.live === 0 && <span>{t.total} centre{t.total === 1 ? "" : "s"}</span>}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </SurfaceProvider>
  );
}

function distinctClusters(activities: Activity[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of activities) {
    const goal = a.pitstops?.[0]?.pitstop?.goal;
    const name = goal?.needsCluster?.name ?? goal?.linkedFacility?.cluster?.name ?? null;
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

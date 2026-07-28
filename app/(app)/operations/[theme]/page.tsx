import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadThemeCatalog, indexThemes, type ThemeDef } from "@/lib/operations/themes";
import { loadCentresForTheme, type CentreRow } from "@/lib/operations/centres";
import { resolveViewContext } from "@/lib/operations/viewAs";
import { PreviewBanner } from "../_shared/PreviewBanner";

export const dynamic = "force-dynamic";

/**
 * Phase-aware thematic portal. Lists the person's centres in this theme,
 * grouped SETTING UP (current phase + step) vs LIVE (this-month visit status).
 */
export default async function OperationsThemePage({
  params,
  searchParams,
}: {
  params: Promise<{ theme: string }>;
  searchParams: Promise<{ asUser?: string; lens?: string; cluster?: string }>;
}) {
  const { asUser, lens: lensParam, cluster: clusterParam } = await searchParams;
  const ctx = await resolveViewContext(asUser);
  if (!ctx) redirect("/login");
  const userId = ctx.userId;
  const preview = ctx.viewingAs;
  const lens: "today" | "overdue" | null =
    lensParam === "today" ? "today" : lensParam === "overdue" ? "overdue" : null;

  const { theme: themeParam } = await params;
  const key = decodeURIComponent(themeParam);

  const catalog = await loadThemeCatalog();
  const theme: ThemeDef | undefined = indexThemes(catalog).get(key);
  // Unknown domain (not in catalog) → treat as a non-facility theme so custom
  // domains still resolve rather than 404.
  const resolved: ThemeDef =
    theme ?? { key, label: key, color: "#6b7280", layerKey: null, isFacility: false, sortOrder: 999 };

  const centres = await loadCentresForTheme([userId], resolved, { clusterId: clusterParam });
  if (centres.length === 0 && !theme) notFound();

  const asUserQ = preview ? `asUser=${encodeURIComponent(userId)}` : "";
  const clusterQ = clusterParam ? `cluster=${encodeURIComponent(clusterParam)}` : "";

  // Carry the lens (+ cluster + view-as) down to the classic centre detail.
  const centreHref = (goalId: string) => {
    const qs = [lens ? `lens=${lens}` : "", clusterQ, asUserQ].filter(Boolean).join("&");
    return `/operations/${encodeURIComponent(key)}/${goalId}${qs ? `?${qs}` : ""}`;
  };
  // Live centres open the visit view (category → tick → close) instead of the classic detail.
  const visitHref = (goalId: string) => {
    const qs = [asUserQ].filter(Boolean).join("&");
    return `/operations/visit/${goalId}${qs ? `?${qs}` : ""}`;
  };
  // A live-lifecycle centre routes to the visit view only once it's actually gone live (mode="live").
  const rowHref = (c: CentreRow) => (c.mode === "live" ? visitHref(c.goalId) : centreHref(c.goalId));
  const backHref = clusterParam
    ? `/operations?${[clusterQ, asUserQ].filter(Boolean).join("&")}`
    : (preview ? `/operations?asUser=${encodeURIComponent(userId)}` : "/operations");

  // Lens views: a single flat list of the centres/geographies that carry work
  // in that bucket, each showing its count. No lens → the full lifecycle view.
  const lensCentres =
    lens === "today" ? centres.filter((c) => c.today > 0)
    : lens === "overdue" ? centres.filter((c) => c.overdue > 0)
    : null;

  const settingUp = centres.filter((c) => c.phase.lifecycle === "setting_up");
  const live = centres.filter((c) => c.phase.lifecycle === "live");
  const done = centres.filter((c) => c.phase.lifecycle === "done");

  return (
    <SurfaceProvider id="operations.theme_portal">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-6">
        {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Operations
          </Link>
          <h1 className="text-lg font-semibold text-stone-900 mt-1 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: resolved.color }} />
            {resolved.label}
          </h1>
          {lens && (
            <p className={`text-xs font-medium mt-0.5 ${lens === "overdue" ? "text-amber-700" : "text-sky-700"}`}>
              {lens === "today" ? "Due today" : "Overdue"}
            </p>
          )}
        </div>

        {lensCentres ? (
          lensCentres.length === 0 ? (
            <EmptyNote label={lens === "today" ? "Nothing due today in this programme." : "Nothing overdue in this programme."} />
          ) : (
            <CentreGroup title={lens === "today" ? "Due today" : "Overdue"} count={lensCentres.length}>
              {lensCentres.map((c) => (
                <CountRow
                  key={c.goalId}
                  centre={c}
                  color={resolved.color}
                  href={rowHref(c)}
                  count={lens === "today" ? c.today : c.overdue}
                  tone={lens === "today" ? "today" : "overdue"}
                />
              ))}
            </CentreGroup>
          )
        ) : (
          <>
            {settingUp.length > 0 && (
              <CentreGroup title="Setting up" count={settingUp.length}>
                {settingUp.map((c) => (
                  <SettingUpRow key={c.goalId} centre={c} color={resolved.color} href={centreHref(c.goalId)} />
                ))}
              </CentreGroup>
            )}

            {live.length > 0 && (
              <CentreGroup title="Live · monthly review" count={live.length}>
                {live.map((c) => (
                  <LiveRow key={c.goalId} centre={c} color={resolved.color} href={rowHref(c)} />
                ))}
              </CentreGroup>
            )}

            {done.length > 0 && (
              <CentreGroup title="Done" count={done.length}>
                {done.map((c) => (
                  <LiveRow key={c.goalId} centre={c} color="#d6d3d1" href={centreHref(c.goalId)} />
                ))}
              </CentreGroup>
            )}

            {centres.length === 0 && (
              <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
                No centres in this theme yet.
              </div>
            )}
          </>
        )}
      </div>
    </SurfaceProvider>
  );
}

function EmptyNote({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
      {label}
    </div>
  );
}

function CountRow({
  centre, color, href, count, tone,
}: {
  centre: CentreRow;
  color: string;
  href: string;
  count: number;
  tone: "today" | "overdue";
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm transition-all">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{centre.name}</p>
        <CentreLocation centre={centre} />
      </div>
      <span
        className={`text-[11px] font-semibold rounded-full px-2 py-0.5 tabular-nums flex-shrink-0 ${
          tone === "overdue"
            ? "text-amber-700 bg-amber-50 border border-amber-200"
            : "text-sky-700 bg-sky-50 border border-sky-200"
        }`}
      >
        {count} {tone === "overdue" ? "overdue" : "today"}
      </span>
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
    </Link>
  );
}

function CentreGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">{title}</h2>
        <span className="text-[10px] text-stone-400">{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function CentreLocation({ centre }: { centre: CentreRow }) {
  const loc = centre.cluster?.name ?? centre.settlement?.name;
  if (!loc) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-stone-400">
      <MapPin className="w-3 h-3" /> {loc}
    </span>
  );
}

function OverdueBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 tabular-nums">
      {n} overdue
    </span>
  );
}

function SettingUpRow({ centre, color, href }: { centre: CentreRow; color: string; href: string }) {
  const { currentPhaseLabel, currentStep, totalSteps } = centre.phase;
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm transition-all">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{centre.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <CentreLocation centre={centre} />
          <OverdueBadge n={centre.overdue} />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-medium text-amber-700">{currentPhaseLabel ?? "In setup"}</p>
        {currentStep != null && totalSteps != null && (
          <p className="text-[11px] text-stone-400 tabular-nums">{currentStep}/{totalSteps}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
    </Link>
  );
}

function LiveRow({ centre, color, href }: { centre: CentreRow; color: string; href: string }) {
  // Live centres show visit cadence (visits done / required this month); fall back to activity
  // totals for non-cadence centres (e.g. done-lifecycle rows).
  const useCadence = centre.cadence != null;
  const done = useCadence ? centre.cadence!.done : centre.month.done;
  const total = useCadence ? centre.cadence!.required : centre.month.total;
  const behind = useCadence && total > 0 && done < total;
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm transition-all">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{centre.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <CentreLocation centre={centre} />
          <OverdueBadge n={centre.overdue} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Dots done={done} total={total} />
        <span className={`text-[11px] tabular-nums ${behind ? "text-amber-600 font-medium" : "text-stone-400"}`}>
          {total > 0 ? `${done}/${total}${useCadence ? " visits" : ""}` : "—"}
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
    </Link>
  );
}

function Dots({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const shown = Math.min(total, 6);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i < done ? "bg-emerald-500" : "bg-stone-200"}`}
        />
      ))}
    </span>
  );
}

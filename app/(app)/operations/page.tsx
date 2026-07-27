import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, CalendarRange, CheckCircle2 } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { loadOperationsHome, type ThemeTile } from "@/lib/operations/home";
import { resolveViewContext, loadViewAsCandidates } from "@/lib/operations/viewAs";
import { PreviewBanner } from "./_shared/PreviewBanner";
import { ViewAsPicker } from "./_shared/ViewAsPicker";

export const dynamic = "force-dynamic";

/**
 * Operations world home. One set of programme (domain) tiles, shown three ways:
 * Today (programmes with work due today), Overdue (programmes carrying overdue
 * work), and Overall (everything the person runs). Tapping a tile opens that
 * programme filtered to the same lens → a centre/geography → its activities and
 * follow-ups. So the drill-down always answers "my tasks today → which centre →
 * what exactly." The month planner is one tap away.
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

  const [tiles, candidates] = await Promise.all([
    loadOperationsHome([userId]),
    ctx.isAdmin && !preview ? loadViewAsCandidates() : Promise.resolve([]),
  ]);

  // Preserve the "view as" identity through every tile link.
  const asUserParam = preview ? `asUser=${encodeURIComponent(userId)}` : "";
  const href = (key: string, lens?: "today" | "overdue") => {
    const qs = [lens ? `lens=${lens}` : "", asUserParam].filter(Boolean).join("&");
    return `/operations/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}`;
  };

  const todayTiles = tiles.filter((t) => t.today > 0).sort((a, b) => b.today - a.today);
  const overdueTiles = tiles.filter((t) => t.overdue > 0).sort((a, b) => b.overdue - a.overdue);

  const whose = preview ? `${preview.name ?? "User"}'s` : "Your";

  return (
    <SurfaceProvider id="operations.today">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-7">
        {preview && <PreviewBanner name={preview.name} exitHref="/operations" />}

        <header className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold text-stone-900">Operations</h1>
          {ctx.isAdmin && !preview && candidates.length > 0 && <ViewAsPicker candidates={candidates} />}
        </header>

        {/* Today — programmes with work due today. */}
        <TileSection title="Today">
          {todayTiles.length === 0 ? (
            <CaughtUp label="Nothing due today." />
          ) : (
            <TileGrid>
              {todayTiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key, "today")} count={t.today} tone="today" />
              ))}
            </TileGrid>
          )}
        </TileSection>

        {/* Overdue — programmes carrying work scheduled before today. */}
        {overdueTiles.length > 0 && (
          <TileSection title="Overdue">
            <TileGrid>
              {overdueTiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key, "overdue")} count={t.overdue} tone="overdue" />
              ))}
            </TileGrid>
          </TileSection>
        )}

        {/* Overall — everything the person runs, by lifecycle. */}
        <TileSection title={`${whose} programmes`}>
          {tiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
              No programmes assigned yet.
            </div>
          ) : (
            <TileGrid>
              {tiles.map((t) => (
                <TileCard key={t.theme.key} tile={t} href={href(t.theme.key)} tone="overall" />
              ))}
            </TileGrid>
          )}
        </TileSection>

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
      </div>
    </SurfaceProvider>
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
  tile, href, count, tone,
}: {
  tile: ThemeTile;
  href: string;
  count?: number;
  tone: "today" | "overdue" | "overall";
}) {
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
          {tone === "today" && <span className="text-sky-600 font-medium tabular-nums">{count} due today</span>}
          {tone === "overdue" && <span className="text-amber-600 font-medium tabular-nums">{count} overdue</span>}
          {tone === "overall" && (
            <>
              {tile.settingUp > 0 && <span className="text-amber-600 font-medium">{tile.settingUp} setting up</span>}
              {tile.settingUp > 0 && tile.live > 0 && <span className="text-stone-300"> · </span>}
              {tile.live > 0 && <span className="text-emerald-600 font-medium">{tile.live} live</span>}
              {tile.settingUp === 0 && tile.live === 0 && <span>{tile.total} centre{tile.total === 1 ? "" : "s"}</span>}
            </>
          )}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400" />
    </Link>
  );
}

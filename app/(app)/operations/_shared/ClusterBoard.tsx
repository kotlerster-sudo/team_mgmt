import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ClusterBoard as ClusterBoardData, BoardCentre } from "@/lib/operations/oversight";
import { GoLiveButton } from "./GoLiveButton";

/**
 * Cluster level of the oversight drill-down: the centres/programmes in this cluster, each with
 * its own activity counts. A supervisor picks a centre to see its per-centre sections (follow-ups
 * / today / overdue / upcoming / overall / past). Setting-up centres carry a Take-live chip.
 */
export function ClusterBoard({ board }: { board: ClusterBoardData }) {
  if (board.centres.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
        No centres in this cluster yet.
      </div>
    );
  }
  const setupCount = board.centres.filter((c) => c.mode !== "live").length;
  const agg = board.centres.reduce(
    (t, c) => {
      t.overdue += c.overdue; t.today += c.today; t.upcoming += c.upcoming; t.followUps += c.followUps;
      return t;
    },
    { overdue: 0, today: 0, upcoming: 0, followUps: 0 },
  );
  return (
    <div className="space-y-3">
      {/* Where this cluster stands, at a glance (Gap 3). */}
      <div className="rounded-xl border border-stone-200 bg-white/60 p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
        <AggStat label="Centres" value={board.centres.length} tone="stone" />
        <AggStat label="Overdue" value={agg.overdue} tone={agg.overdue > 0 ? "red" : "stone"} />
        <AggStat label="Today" value={agg.today} tone={agg.today > 0 ? "sky" : "stone"} />
        <AggStat label="Upcoming" value={agg.upcoming} tone="stone" />
        <AggStat label="Follow-ups" value={agg.followUps} tone={agg.followUps > 0 ? "amber" : "stone"} />
      </div>
      <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
        {board.centres.length} centre{board.centres.length === 1 ? "" : "s"}
        {setupCount > 0 && <span className="text-amber-600"> · {setupCount} to take live</span>}
      </p>
      <div className="space-y-1.5">
        {board.centres.map((c) => <CentreRow key={c.goalId} c={c} />)}
      </div>
    </div>
  );
}

function AggStat({ label, value, tone }: { label: string; value: number; tone: "red" | "sky" | "amber" | "stone" }) {
  const color = { red: "text-red-600", sky: "text-sky-600", amber: "text-amber-600", stone: "text-stone-700" }[tone];
  return (
    <div className="text-center">
      <div className={`text-lg font-semibold tabular-nums ${value === 0 && tone !== "stone" ? "text-stone-300" : color}`}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
    </div>
  );
}

function CentreRow({ c }: { c: BoardCentre }) {
  return (
    <div className="group flex items-center gap-2 rounded-xl border border-stone-200 bg-white pr-2 hover:border-stone-300 hover:shadow-sm transition-all">
      <Link
        href={`/operations/${encodeURIComponent(c.themeKey)}/${c.goalId}?from=oversight`}
        className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-stone-800 truncate">{c.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <LifecycleChip mode={c.mode} />
            {c.ownerName && <span className="text-[11px] text-stone-400 truncate">{c.ownerName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {c.overdue > 0 && <Chip tone="red">{c.overdue} overdue</Chip>}
          {c.today > 0 && <Chip tone="sky">{c.today} today</Chip>}
          {c.upcoming > 0 && <Chip tone="stone">{c.upcoming} upcoming</Chip>}
          {c.followUps > 0 && <Chip tone="amber">{c.followUps} follow-up{c.followUps === 1 ? "" : "s"}</Chip>}
        </div>
        <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
      </Link>
      {c.canGoLive && <GoLiveButton goalId={c.goalId} variant="compact" />}
    </div>
  );
}

function LifecycleChip({ mode }: { mode: string }) {
  const live = mode === "live";
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap border ${live ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
      {live ? "live" : "setup"}
    </span>
  );
}

function Chip({ tone, children }: { tone: "red" | "sky" | "stone" | "amber"; children: React.ReactNode }) {
  const cls = {
    red: "text-red-700 bg-red-50 border-red-200",
    sky: "text-sky-700 bg-sky-50 border-sky-200",
    stone: "text-stone-500 bg-stone-100 border-stone-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
  }[tone];
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

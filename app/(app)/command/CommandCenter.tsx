"use client";

/**
 * Command-center client root — owns URL state, fetches the rollup once per
 * (zone, month), and renders the three views over the same rows:
 *   tree   → DrillGrid (geography / by-RP / by-programme lens)
 *   visits → VisitHeatmap (centre × month cadence compliance)
 *   setup  → SetupMatrix (setup goal × workstream progress)
 * plus the always-visible NeedsStrip and the right DetailPanel.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { Radar } from "lucide-react";
import type { CommandRollup, CommandZoneOption } from "@/lib/operations/command";
import { useCommandState } from "./useCommandState";
import { ScopeBar } from "./_components/ScopeBar";
import { NeedsStrip } from "./_components/NeedsStrip";
import { DrillGrid } from "./_components/DrillGrid";
import { VisitHeatmap } from "./_components/VisitHeatmap";
import { SetupMatrix } from "./_components/SetupMatrix";
import { DetailPanel } from "./_components/DetailPanel";

function CommandCenterInner({ zones }: { zones: CommandZoneOption[] }) {
  const { state, update } = useCommandState(zones[0].id);
  const [rollup, setRollup] = useState<CommandRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const zoneId = zones.some((z) => z.id === state.zoneId) ? state.zoneId : zones[0].id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ zoneId });
    if (state.month) qs.set("month", state.month);
    fetch(`/api/command/rollup?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: CommandRollup) => {
        if (cancelled) return;
        setRollup(d);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zoneId, state.month]);

  const selectedRow = useMemo(
    () => rollup?.rows.find((r) => r.goalId === state.sel) ?? null,
    [rollup, state.sel],
  );

  const stats = useMemo(() => {
    if (!rollup) return null;
    const live = rollup.rows.filter((r) => r.phase.lifecycle === "live").length;
    const settingUp = rollup.rows.filter((r) => r.phase.lifecycle === "setting_up").length;
    const apOpen = rollup.rows.reduce((s, r) => s + r.aps.open, 0);
    const stuck = rollup.rows.filter(
      (r) => r.setup?.front && (r.setup.front.daysOverdue > 0 || r.setup.front.daysStuck >= 14),
    ).length;
    return { total: rollup.rows.length, live, settingUp, apOpen, stuck };
  }, [rollup]);

  const onSelect = (goalId: string) => update({ sel: goalId === state.sel ? null : goalId });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-4">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-sky-600 shrink-0" />
          <h1 className="text-lg font-semibold text-stone-900">Command Center</h1>
        </div>
        {stats && (
          <p className="text-sm text-stone-500 mt-0.5">
            {stats.total} centre{stats.total === 1 ? "" : "s"} ·{" "}
            <span className="text-emerald-600 font-medium">{stats.live} live</span> ·{" "}
            <span className="text-amber-600 font-medium">{stats.settingUp} setting up</span>
            {stats.stuck > 0 && (
              <> · <span className="text-red-600 font-medium">{stats.stuck} stuck</span></>
            )}
            {stats.apOpen > 0 && <> · {stats.apOpen} open follow-ups</>}
          </p>
        )}
      </header>

      <ScopeBar
        zones={zones}
        zoneId={zoneId}
        month={state.month}
        lens={state.lens}
        view={state.view}
        onChange={update}
      />

      <NeedsStrip zoneId={zoneId} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
          Couldn&apos;t load the rollup — refresh to retry.
        </div>
      )}
      {loading && !rollup && (
        <div className="border border-stone-200 rounded-xl overflow-hidden bg-white animate-pulse">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-stone-50 last:border-b-0">
              <div className="w-2.5 h-2.5 rounded-full bg-stone-200 shrink-0" />
              <div className="h-3 rounded bg-stone-200" style={{ width: `${30 + ((i * 13) % 40)}%` }} />
              <div className="flex-1" />
              <div className="h-3 w-16 rounded bg-stone-100 hidden sm:block" />
              <div className="h-3 w-10 rounded bg-stone-100" />
            </div>
          ))}
        </div>
      )}

      {rollup && (
        <div className={`flex flex-col lg:flex-row gap-4 items-start transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          <main className="flex-1 min-w-0 w-full">
            {state.view === "tree" && (
              <DrillGrid rows={rollup.rows} lens={state.lens} selected={state.sel} onSelect={onSelect} />
            )}
            {state.view === "visits" && (
              <VisitHeatmap
                rows={rollup.rows}
                months={rollup.months}
                lens={state.lens}
                selected={state.sel}
                onSelect={onSelect}
              />
            )}
            {state.view === "setup" && (
              <SetupMatrix rows={rollup.rows} lens={state.lens} selected={state.sel} onSelect={onSelect} />
            )}
          </main>
          {selectedRow && (
            <div className="w-full lg:w-[400px] lg:shrink-0 lg:sticky lg:top-4">
              <DetailPanel row={selectedRow} onClose={() => update({ sel: null })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommandCenter({ zones }: { zones: CommandZoneOption[] }) {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-stone-400">Loading…</div>}>
      <CommandCenterInner zones={zones} />
    </Suspense>
  );
}

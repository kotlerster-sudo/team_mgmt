"use client";

/**
 * The pivot drill grid — one row per centre/goal, grouped by the active lens:
 *
 *   geo  → cluster (rows carry settlement as secondary text)
 *   rp   → owning RP
 *   prog → programme theme
 *
 * All three lenses regroup the SAME CommandRow[] client-side, so numbers can
 * never disagree across lenses. Group headers aggregate; row click opens the
 * detail panel.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MapPin, User as UserIcon, Layers } from "lucide-react";
import type { CommandRow } from "@/lib/operations/command";
import type { CommandLens } from "../useCommandState";
import { ApsCell, IndicatorChips, PhaseChip, Sparkline, StuckBadge, VisitDots } from "./cells";

/** 6-month cadence-compliance trend (0..1 per month) for a live centre. */
function complianceTrend(live: NonNullable<CommandRow["live"]>): number[] {
  return live.monthly.map((m) => (m.required > 0 ? Math.min(1, m.done / m.required) : m.done > 0 ? 1 : 0));
}

type Group = {
  key: string;
  label: string;
  color: string | null;
  rows: CommandRow[];
};

export function groupRows(rows: CommandRow[], lens: CommandLens): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    let key: string, label: string, color: string | null;
    if (lens === "rp") {
      key = r.rp?.id ?? "__none__";
      label = r.rp?.name ?? "Unassigned";
      color = null;
    } else if (lens === "prog") {
      key = r.themeKey;
      label = r.themeLabel;
      color = r.themeColor;
    } else {
      key = r.clusterId ?? "__none__";
      label = r.clusterName ?? "Unassigned";
      color = null;
    }
    const g = map.get(key) ?? { key, label, color, rows: [] };
    g.rows.push(r);
    map.set(key, g);
  }
  const groups = [...map.values()];
  // Unassigned last, otherwise alphabetical.
  groups.sort((a, b) =>
    (a.key === "__none__" ? 1 : 0) - (b.key === "__none__" ? 1 : 0) || a.label.localeCompare(b.label),
  );
  for (const g of groups) {
    g.rows.sort(
      (a, b) =>
        (a.settlementName ?? "").localeCompare(b.settlementName ?? "") || a.name.localeCompare(b.name),
    );
  }
  return groups;
}

function groupStats(rows: CommandRow[]) {
  let live = 0,
    setup = 0,
    vDone = 0,
    vRequired = 0,
    apOpen = 0,
    apOverdue = 0,
    stuck = 0,
    overdueActs = 0;
  for (const r of rows) {
    if (r.phase.lifecycle === "setting_up") setup++;
    else if (r.phase.lifecycle === "live") live++;
    if (r.live) {
      vDone += r.live.cadence.done;
      vRequired += r.live.cadence.required;
    }
    apOpen += r.aps.open;
    apOverdue += r.aps.overdue;
    if (r.setup?.front && (r.setup.front.daysOverdue > 0 || r.setup.front.daysStuck >= 14)) stuck++;
    overdueActs += r.setup?.overdueActivities ?? 0;
  }
  return { live, setup, vDone, vRequired, apOpen, apOverdue, stuck, overdueActs };
}

const LENS_ICON: Record<CommandLens, React.ReactNode> = {
  geo: <MapPin className="w-3.5 h-3.5 text-sky-500" />,
  rp: <UserIcon className="w-3.5 h-3.5 text-violet-500" />,
  prog: <Layers className="w-3.5 h-3.5 text-emerald-500" />,
};

const GRID_COLS = "minmax(180px,2fr) 120px 150px 80px minmax(160px,1.6fr)";

export function DrillGrid({
  rows,
  lens,
  selected,
  onSelect,
}: {
  rows: CommandRow[];
  lens: CommandLens;
  selected: string | null;
  onSelect: (goalId: string) => void;
}) {
  const groups = useMemo(() => groupRows(rows, lens), [rows, lens]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 p-10 text-center text-sm text-stone-400">
        No programme centres or setup goals in this scope yet.
      </div>
    );
  }

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
      {/* Desktop column headers */}
      <div
        className="hidden md:grid items-center gap-x-3 px-3 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <span>Centre / goal</span>
        <span>Phase</span>
        <span>This month</span>
        <span>Follow-ups</span>
        <span>Indicators</span>
      </div>

      <div className="divide-y divide-stone-100">
        {groups.map((g) => {
          const s = groupStats(g.rows);
          const isOpen = !closed.has(g.key);
          return (
            <div key={g.key}>
              {/* Group header — stacks on mobile so aggregates stay visible */}
              <button
                onClick={() => toggle(g.key)}
                className="w-full flex flex-col md:flex-row md:items-center gap-1 md:gap-2 px-3 py-2.5 bg-stone-50/60 hover:bg-stone-100 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0 w-full md:w-auto">
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  )}
                  {g.color ? (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                  ) : (
                    LENS_ICON[lens]
                  )}
                  <span className="text-sm font-semibold text-stone-800 truncate">{g.label}</span>
                  <span className="text-[11px] text-stone-400 shrink-0">
                    {g.rows.length} · {s.live} live · {s.setup} setting up
                  </span>
                </div>
                <span className="hidden md:block md:flex-1" />
                {(s.vRequired > 0 || s.apOpen > 0 || s.stuck > 0 || s.overdueActs > 0) && (
                  <span className="flex items-center gap-2 md:gap-3 text-[11px] tabular-nums flex-wrap pl-5 md:pl-0">
                    {s.vRequired > 0 && (
                      <span
                        className={s.vDone >= s.vRequired ? "text-emerald-600 font-semibold" : "text-stone-500"}
                        title="Cadence visits done / required this month"
                      >
                        visits {s.vDone}/{s.vRequired}
                      </span>
                    )}
                    {s.apOpen > 0 && (
                      <span className={s.apOverdue > 0 ? "text-red-600 font-semibold" : "text-stone-500"}>
                        {s.apOpen} follow-up{s.apOpen === 1 ? "" : "s"}
                      </span>
                    )}
                    {s.stuck > 0 && <span className="text-red-600 font-semibold">{s.stuck} stuck</span>}
                    {s.overdueActs > 0 && <span className="text-amber-600">{s.overdueActs} overdue acts</span>}
                  </span>
                )}
              </button>

              {/* Rows */}
              {isOpen &&
                g.rows.map((r) => {
                  const isSel = selected === r.goalId;
                  return (
                    <div
                      key={r.goalId}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(r.goalId)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(r.goalId)}
                      className={`cursor-pointer transition-colors border-t border-stone-50 ${
                        isSel ? "bg-sky-50 ring-1 ring-inset ring-sky-200" : "hover:bg-stone-50"
                      }`}
                    >
                      {/* Desktop */}
                      <div
                        className="hidden md:grid items-center gap-x-3 px-3 py-2.5"
                        style={{ gridTemplateColumns: GRID_COLS }}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          {lens !== "prog" && (
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: r.themeColor }}
                              title={r.themeLabel}
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-stone-800 truncate">{r.name}</p>
                            <p className="text-[10px] text-stone-400 truncate">
                              {lens === "geo"
                                ? (r.settlementName ?? r.themeLabel)
                                : [r.settlementName, r.clusterName].filter(Boolean).join(" · ") || r.themeLabel}
                              {lens === "rp" ? ` · ${r.themeLabel}` : ""}
                            </p>
                          </div>
                        </div>
                        <div>
                          <PhaseChip row={r} />
                        </div>
                        <div className="min-w-0">
                          {r.live ? (
                            <span className="inline-flex items-center gap-2">
                              <VisitDots done={r.live.cadence.done} required={r.live.cadence.required} />
                              <span className="opacity-70" title="6-month cadence trend">
                                <Sparkline
                                  points={complianceTrend(r.live)}
                                  width={40}
                                  height={16}
                                  stroke={r.live.cadence.done >= r.live.cadence.required ? "#10b981" : "#f59e0b"}
                                />
                              </span>
                            </span>
                          ) : r.setup ? (
                            <StuckBadge setup={r.setup} />
                          ) : (
                            <span className="text-[11px] text-stone-300">—</span>
                          )}
                        </div>
                        <div>
                          <ApsCell aps={r.aps} />
                        </div>
                        <div className="min-w-0">
                          <IndicatorChips indicators={r.indicators} />
                        </div>
                      </div>

                      {/* Mobile card */}
                      <div className="md:hidden px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.themeColor }} />
                          <p className="text-xs font-medium text-stone-800 truncate flex-1">{r.name}</p>
                          <PhaseChip row={r} />
                        </div>
                        <p className="text-[10px] text-stone-400 truncate">
                          {[r.settlementName, r.clusterName, r.rp?.name].filter(Boolean).join(" · ")}
                        </p>
                        <div className="flex items-center gap-3 flex-wrap">
                          {r.live && <VisitDots done={r.live.cadence.done} required={r.live.cadence.required} />}
                          {r.setup && <StuckBadge setup={r.setup} />}
                          <ApsCell aps={r.aps} />
                        </div>
                        <IndicatorChips indicators={r.indicators} max={3} />
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

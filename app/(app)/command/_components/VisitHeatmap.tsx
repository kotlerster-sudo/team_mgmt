"use client";

/**
 * Visit-compliance heatmap — live centres × last 6 months, cell = cadence
 * visits done vs required. Answers "did the RP visit every creche each month"
 * at a glance. Data comes straight off CommandRow.live.monthly (no extra
 * fetch). Historical months use the CURRENT cadence (cadence history isn't
 * stored) — disclosed in the footer.
 */

import { useMemo } from "react";
import type { CommandRow } from "@/lib/operations/command";
import type { CommandLens } from "../useCommandState";
import { groupRows } from "./DrillGrid";
import { monthLabel } from "./cells";

function cellClasses(done: number, required: number): string {
  if (required === 0) {
    return done > 0 ? "bg-emerald-100 text-emerald-700" : "bg-stone-50 text-stone-300";
  }
  if (done >= required) return "bg-emerald-500 text-white";
  if (done > 0) return "bg-amber-300 text-amber-900";
  return "bg-red-200 text-red-800";
}

export function VisitHeatmap({
  rows,
  months,
  lens,
  selected,
  onSelect,
}: {
  rows: CommandRow[];
  months: string[];
  lens: CommandLens;
  selected: string | null;
  onSelect: (goalId: string) => void;
}) {
  const liveRows = useMemo(() => rows.filter((r) => r.live), [rows]);
  const groups = useMemo(() => groupRows(liveRows, lens), [liveRows, lens]);

  if (liveRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 p-10 text-center text-sm text-stone-400">
        No live centres in this scope yet — the heatmap fills in once centres go live.
      </div>
    );
  }

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-100">
              <th className="sticky left-0 bg-stone-50 z-10 text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 min-w-[180px]">
                Centre
              </th>
              {months.map((ym) => (
                <th key={ym} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 text-center min-w-[52px]">
                  {monthLabel(ym)}
                </th>
              ))}
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 text-left min-w-[100px]">
                Last visit
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows
                key={g.key}
                label={g.label}
                color={g.color}
                rows={g.rows}
                months={months}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-stone-400 border-t border-stone-100">
        Cell = cadence visits done / required that month. Past months assume the centre&apos;s current
        cadence (cadence history isn&apos;t stored).
      </p>
    </div>
  );
}

function GroupRows({
  label,
  color,
  rows,
  months,
  selected,
  onSelect,
}: {
  label: string;
  color: string | null;
  rows: CommandRow[];
  months: string[];
  selected: string | null;
  onSelect: (goalId: string) => void;
}) {
  return (
    <>
      <tr className="bg-stone-50/60 border-t border-stone-100">
        <td colSpan={months.length + 2} className="sticky left-0 px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-600">
            {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
            {label}
            <span className="font-normal text-stone-400">· {rows.length}</span>
          </span>
        </td>
      </tr>
      {rows.map((r) => {
        const byYm = new Map((r.live?.monthly ?? []).map((m) => [m.ym, m]));
        const isSel = selected === r.goalId;
        return (
          <tr
            key={r.goalId}
            onClick={() => onSelect(r.goalId)}
            className={`cursor-pointer border-t border-stone-50 transition-colors ${
              isSel ? "bg-sky-50" : "hover:bg-stone-50"
            }`}
          >
            <td className={`sticky left-0 z-10 px-3 py-1.5 ${isSel ? "bg-sky-50" : "bg-white"}`}>
              <p className="text-xs font-medium text-stone-800 truncate max-w-[200px]">{r.name}</p>
              <p className="text-[10px] text-stone-400 truncate max-w-[200px]">
                {[r.settlementName, r.rp?.name].filter(Boolean).join(" · ")}
              </p>
            </td>
            {months.map((ym) => {
              const m = byYm.get(ym);
              const done = m?.done ?? 0;
              const required = m?.required ?? 0;
              return (
                <td key={ym} className="px-1 py-1 text-center">
                  <span
                    className={`inline-flex items-center justify-center rounded-md w-11 h-6 text-[10px] font-semibold tabular-nums ${cellClasses(done, required)}`}
                    title={`${monthLabel(ym)}: ${done} done / ${required} required`}
                  >
                    {required === 0 && done === 0 ? "–" : `${done}/${required}`}
                  </span>
                </td>
              );
            })}
            <td className="px-3 py-1.5 text-[11px] text-stone-500 whitespace-nowrap">
              {r.live?.lastVisitAt
                ? new Date(r.live.lastVisitAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                : <span className="text-red-500 font-medium">never</span>}
            </td>
          </tr>
        );
      })}
    </>
  );
}

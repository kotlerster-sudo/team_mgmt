"use client";

/**
 * Setup matrix — setup goals × workstream columns. Answers "the zone was
 * supposed to set up 5 children centres: at what step is each stuck, for how
 * long, and is one dragging the rest". Columns are the union of the rows'
 * progressTag workstreams in canonical order (lib/progressTags.ts) — fully
 * config-driven, no hardcoded phases.
 */

import { useMemo } from "react";
import { Flame } from "lucide-react";
import type { CommandRow } from "@/lib/operations/command";
import type { CommandLens } from "../useCommandState";
import { orderProgressTags } from "@/lib/progressTags";
import { groupRows } from "./DrillGrid";

function cellClasses(done: number, total: number, blocked: boolean, isFront: boolean): string {
  let base: string;
  if (blocked) base = "bg-red-100 text-red-700";
  else if (total > 0 && done >= total) base = "bg-emerald-500 text-white";
  else if (done > 0) base = "bg-amber-200 text-amber-900";
  else base = "bg-stone-100 text-stone-400";
  return `${base}${isFront ? " ring-2 ring-sky-500 ring-offset-1" : ""}`;
}

export function SetupMatrix({
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
  const setupRows = useMemo(() => rows.filter((r) => r.setup && r.phase.lifecycle === "setting_up"), [rows]);
  const groups = useMemo(() => groupRows(setupRows, lens), [setupRows, lens]);
  const columns = useMemo(
    () => orderProgressTags(setupRows.flatMap((r) => r.setup!.workstreams.map((w) => w.tag))),
    [setupRows],
  );

  if (setupRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 p-10 text-center text-sm text-stone-400">
        No goals in setup in this scope — everything is live or done.
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
                Setup goal
              </th>
              {columns.map((c) => (
                <th key={c} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 text-center min-w-[80px]">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 text-left min-w-[150px]">
                Stuck on
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <MatrixGroup
                key={g.key}
                label={g.label}
                color={g.color}
                rows={g.rows}
                columns={columns}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-stone-400 border-t border-stone-100">
        Cell = setup steps done / total per workstream. Red = blocked by a dependency; blue outline =
        the current front step&apos;s workstream.
      </p>
    </div>
  );
}

function MatrixGroup({
  label,
  color,
  rows,
  columns,
  selected,
  onSelect,
}: {
  label: string;
  color: string | null;
  rows: CommandRow[];
  columns: string[];
  selected: string | null;
  onSelect: (goalId: string) => void;
}) {
  return (
    <>
      <tr className="bg-stone-50/60 border-t border-stone-100">
        <td colSpan={columns.length + 2} className="sticky left-0 px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-600">
            {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
            {label}
            <span className="font-normal text-stone-400">· {rows.length}</span>
          </span>
        </td>
      </tr>
      {rows.map((r) => {
        const setup = r.setup!;
        const byTag = new Map(setup.workstreams.map((w) => [w.tag, w]));
        const isSel = selected === r.goalId;
        const front = setup.front;
        const hot = !!front && (front.daysOverdue > 0 || front.daysStuck >= 14);
        return (
          <tr
            key={r.goalId}
            onClick={() => onSelect(r.goalId)}
            className={`cursor-pointer border-t border-stone-50 transition-colors ${
              isSel ? "bg-sky-50" : "hover:bg-stone-50"
            }`}
          >
            <td className={`sticky left-0 z-10 px-3 py-2 ${isSel ? "bg-sky-50" : "bg-white"}`}>
              <p className="text-xs font-medium text-stone-800 truncate max-w-[200px]">{r.name}</p>
              <p className="text-[10px] text-stone-400 truncate max-w-[200px]">
                {[r.settlementName ?? r.clusterName, r.rp?.name].filter(Boolean).join(" · ")}
                {r.phase.currentStep != null && r.phase.totalSteps != null && (
                  <span className="tabular-nums"> · step {r.phase.currentStep}/{r.phase.totalSteps}</span>
                )}
              </p>
            </td>
            {columns.map((tag) => {
              const w = byTag.get(tag);
              const isFront = front?.workstream === tag;
              if (!w) {
                return (
                  <td key={tag} className="px-1.5 py-1.5 text-center">
                    <span className="text-[10px] text-stone-200">·</span>
                  </td>
                );
              }
              return (
                <td key={tag} className="px-1.5 py-1.5 text-center">
                  <span
                    className={`inline-flex items-center justify-center rounded-md min-w-[44px] h-6 px-1.5 text-[10px] font-semibold tabular-nums ${cellClasses(w.done, w.total, w.blocked, isFront)}`}
                    title={`${tag}: ${w.done}/${w.total} done${w.blocked ? " · blocked by dependency" : ""}${isFront ? ` · current step: ${front?.title}` : ""}`}
                  >
                    {w.done}/{w.total}
                  </span>
                </td>
              );
            })}
            <td className="px-3 py-2">
              {front ? (
                <span className={`inline-flex items-center gap-1 text-[11px] ${hot ? "text-red-600" : "text-stone-600"}`}>
                  {front.onCriticalPath && (
                    <Flame className={`w-3 h-3 shrink-0 ${hot ? "text-red-500" : "text-amber-500"}`} />
                  )}
                  <span className="truncate max-w-[160px]">{front.title}</span>
                  <span className={`tabular-nums shrink-0 ${hot ? "font-semibold" : "text-stone-400"}`}>
                    ~{front.daysStuck}d
                  </span>
                  {front.daysOverdue > 0 && (
                    <span className="text-red-500 font-semibold tabular-nums shrink-0">
                      +{front.daysOverdue}d late
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[11px] text-stone-300">—</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

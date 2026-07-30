"use client";

import { Target, User, Wind } from "lucide-react";
import type { CentrePlan } from "@/lib/operations/plan";
import type { Agenda } from "./dueState";
import { DueChip } from "./DueChip";
import { StatusIcon } from "./statusIcon";

/**
 * Top summary band. When nodes are overdue or due today it becomes the "On this visit" agenda —
 * the RP's jobs at this centre right now (ranked critical-path first); tapping a row opens the
 * node sheet + scrolls to the card. Otherwise it's the mock's "This week" line: the current
 * critical-path blocker + where slack lives.
 */
export function ThisWeekPanel({ plan, agenda, onSelect }: {
  plan: CentrePlan;
  agenda?: Agenda;
  onSelect?: (pitstopId: string) => void;
}) {
  const { thisWeek, slackBranches, counts } = plan;
  const rows = agenda?.rows ?? [];
  const anyOverdue = rows.some((r) => r.due.kind === "overdue");

  return (
    <div className="rounded-xl border border-stone-200 bg-white/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Target className={`w-4 h-4 shrink-0 ${rows.length > 0 && !anyOverdue ? "text-amber-500" : "text-red-500"}`} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            {rows.length > 0 ? "On this visit" : "This week"}
          </span>
          {rows.length === 0 && (thisWeek ? (
            <span className="text-stone-800 truncate">
              <span className="text-stone-400 tabular-nums mr-1">{thisWeek.wbs}</span>
              {thisWeek.title}
              {thisWeek.ownerName && <span className="text-stone-400"> · {thisWeek.ownerName}</span>}
              {thisWeek.targetDate && <span className="text-stone-400"> · by {new Date(thisWeek.targetDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
            </span>
          ) : (
            <span className="text-stone-400">{counts.total === counts.done ? "All nodes complete" : "Nothing blocking — pick up any open node"}</span>
          ))}
        </div>
        {slackBranches.length > 0 && (
          <div className="flex items-center gap-1.5 text-stone-500">
            <Wind className="w-3.5 h-3.5 text-stone-400" />
            <span className="text-[11px]">Slack in <span className="font-medium">{slackBranches.join(", ")}</span></span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-stone-400">
          <span><span className="text-emerald-600 font-semibold tabular-nums">{counts.done}</span>/{counts.total} done</span>
          {counts.blocked > 0 && <span className="text-red-500 font-medium">{counts.blocked} blocked</span>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {rows.map((r) => (
            <button
              key={r.pitstopId}
              onClick={() => onSelect?.(r.pitstopId)}
              className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-stone-50"
            >
              <StatusIcon status={r.status} className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] font-semibold text-stone-400 tabular-nums shrink-0">{r.wbs}</span>
              <span className="text-sm text-stone-800 truncate flex-1 min-w-0">{r.title}</span>
              {r.onCriticalPath && <span className="text-[9px] font-bold uppercase text-red-500 tracking-wide shrink-0">critical</span>}
              {r.ownerName && (
                <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-stone-400 shrink-0">
                  <User className="w-2.5 h-2.5" />{r.ownerName}
                </span>
              )}
              <DueChip due={r.due} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

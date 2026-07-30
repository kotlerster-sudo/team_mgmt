"use client";

import { Target, Wind } from "lucide-react";
import type { CentrePlan } from "@/lib/operations/plan";

/** The mock's "This week" summary: the current critical-path blocker + where slack lives. */
export function ThisWeekPanel({ plan }: { plan: CentrePlan }) {
  const { thisWeek, slackBranches, counts } = plan;
  return (
    <div className="rounded-xl border border-stone-200 bg-white/60 p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Target className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">This week</span>
        {thisWeek ? (
          <span className="text-stone-800 truncate">
            <span className="text-stone-400 tabular-nums mr-1">{thisWeek.wbs}</span>
            {thisWeek.title}
            {thisWeek.ownerName && <span className="text-stone-400"> · {thisWeek.ownerName}</span>}
            {thisWeek.targetDate && <span className="text-stone-400"> · by {new Date(thisWeek.targetDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
          </span>
        ) : (
          <span className="text-stone-400">{counts.total === counts.done ? "All nodes complete" : "Nothing blocking — pick up any open node"}</span>
        )}
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
  );
}

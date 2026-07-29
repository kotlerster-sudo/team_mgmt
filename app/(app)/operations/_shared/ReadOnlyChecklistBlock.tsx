"use client";

import { CheckCircle2, Mic, Paperclip, CircleDot, Gauge } from "lucide-react";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";
import { fmtTime, daysAgo } from "@/app/(app)/home/_lib/helpers";

/**
 * Read-only mirror of the RP's visit-page `ChecklistBlock` (operations/visit/[goalId]/page.tsx).
 * Same visual grammar — checklist header (status, completion-type, required/pending badges,
 * done-count), the indicators it captures, then its activity rows — but with NO action buttons.
 * Used by the supervisory drill-down so a ZL/PM sees exactly what the RP works through, without
 * being able to complete on their behalf.
 */
export function ReadOnlyChecklistBlock({
  checklist,
  items,
  overdue = false,
}: {
  checklist: ChecklistItem | null;
  items: Activity[];
  overdue?: boolean;
}) {
  // Done-count spans the whole checklist (not just this bucket) so it reads like the RP's card.
  const all = checklist?.activities ?? [];
  const totalCount = all.length;
  const doneCount = all.filter((a) => a.status === "Done").length;
  const allDone = totalCount > 0 && doneCount === totalCount;
  const completionType = checklist?.completionType ?? "Activity";
  const indicators = checklist?.indicators ?? [];

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-2">
      <div className="flex items-center gap-2 px-1 pb-1.5">
        {allDone
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          : <span className="w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0" />}
        <span className={`text-[13px] font-medium flex-1 min-w-0 truncate ${allDone ? "text-stone-400" : "text-stone-800"}`}>
          {checklist?.text ?? "Other activities"}
        </span>
        <CompletionChip type={completionType} />
        {checklist?.approval === "pending" && (
          <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full shrink-0">pending</span>
        )}
        {checklist?.mandatory && !allDone && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full shrink-0">required</span>
        )}
        {totalCount > 1 && (
          <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{doneCount}/{totalCount}</span>
        )}
      </div>

      {indicators.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap px-1 pb-1.5">
          <Gauge className="w-3 h-3 text-stone-400 shrink-0" />
          {indicators.map((ind, i) => (
            <span
              key={`${ind.label}-${i}`}
              className="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap"
              style={{ color: ind.color, borderColor: `${ind.color}55`, background: `${ind.color}10` }}
              title={ind.kind === "journey" ? "Programme journey outcome" : "Facility indicator"}
            >
              {ind.label}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {items.map((a) => <ReadOnlyActivityRow key={a.id} activity={a} overdue={overdue} />)}
      </div>
    </div>
  );
}

function CompletionChip({ type }: { type: string }) {
  const map: Record<string, { icon: typeof Mic; label: string }> = {
    Voice: { icon: Mic, label: "Voice" },
    Upload: { icon: Paperclip, label: "Photo" },
    Activity: { icon: CircleDot, label: "Mark done" },
  };
  const { icon: Icon, label } = map[type] ?? map.Activity;
  return (
    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-stone-500 bg-white border border-stone-200 rounded-full px-1.5 py-0.5 shrink-0">
      <Icon className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

/** Non-interactive activity row — time / overdue age, title, done-state. */
export function ReadOnlyActivityRow({ activity, overdue }: { activity: Activity; overdue: boolean }) {
  const done = activity.status === "Done";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
      done ? "border-stone-100 bg-white/50" :
      overdue ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"
    }`}>
      <div className="flex-shrink-0 w-12 text-right">
        {overdue && !done
          ? <span className="text-[10px] font-semibold text-amber-700">{daysAgo(activity.scheduledAt)}d</span>
          : <span className="text-[11px] font-medium text-stone-500 tabular-nums">{fmtTime(activity.scheduledAt)}</span>}
      </div>
      <p className={`flex-1 min-w-0 text-sm truncate ${done ? "text-stone-400 line-through" : "text-stone-700"}`}>
        {activity.title}
      </p>
      {done && (
        <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" /> Done
        </span>
      )}
    </div>
  );
}

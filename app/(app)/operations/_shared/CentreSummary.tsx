"use client";

import { Repeat } from "lucide-react";

/**
 * "Where do things stand" band for a centre (and reused, aggregated, at cluster level).
 * Answers the supervisor's core question at a glance: how much needed to have happened
 * (overdue), is due now (today), is coming up (upcoming), is open overall, is done, and
 * how many follow-ups are hanging — plus the lifecycle + this month's visit cadence.
 */
export type SummaryCounts = {
  overdue: number;
  today: number;
  upcoming: number;
  overall: number;
  done: number;
  followUps: number;
};

export function CentreSummary({
  counts,
  lifecycle,
  monthDone,
  monthRequired,
}: {
  counts: SummaryCounts;
  lifecycle?: "setting_up" | "live" | "done";
  monthDone?: number | null;
  monthRequired?: number | null;
}) {
  const cadence =
    lifecycle === "live" && monthRequired != null && monthRequired > 0
      ? { done: monthDone ?? 0, required: monthRequired }
      : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white/60 p-3">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? "red" : "stone"} />
        <Stat label="Today" value={counts.today} tone={counts.today > 0 ? "sky" : "stone"} />
        <Stat label="Upcoming" value={counts.upcoming} tone="stone" />
        <Stat label="Open" value={counts.overall} tone="stone" />
        <Stat label="Done" value={counts.done} tone="emerald" />
        <Stat label="Follow-ups" value={counts.followUps} tone={counts.followUps > 0 ? "amber" : "stone"} />
      </div>
      {cadence && (
        <div className="mt-2.5 pt-2.5 border-t border-stone-100 flex items-center gap-1.5 text-xs text-sky-700">
          <Repeat className="w-3.5 h-3.5" />
          <span className="font-medium">{cadence.done}/{cadence.required}</span>
          <span className="text-stone-400">visits this month</span>
          {cadence.done < cadence.required && (
            <span className="text-amber-600 font-medium">· {cadence.required - cadence.done} to go</span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "sky" | "amber" | "emerald" | "stone" }) {
  const color = {
    red: "text-red-600",
    sky: "text-sky-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    stone: "text-stone-700",
  }[tone];
  return (
    <div className="text-center">
      <div className={`text-lg font-semibold tabular-nums ${value === 0 && tone !== "stone" ? "text-stone-300" : color}`}>
        {value}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
    </div>
  );
}

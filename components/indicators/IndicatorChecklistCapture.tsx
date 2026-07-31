"use client";

/**
 * IndicatorChecklistCapture — scored tick-list rendered inside
 * CompleteActivityModal when an indicator binding's def carries
 * IndicatorChecklistItemDef rows (creche 24-point safety first).
 *
 * Items are grouped by category (seed order preserved), non-negotiables get a
 * star badge, and each row is a Yes / No (/ N-A when allowed) segmented
 * control. Clicking the selected answer again clears it. Score shown in a
 * sticky footer = count(yes) + count(na) — mirrors the server-side compute in
 * lib/captureIndicatorPoints.ts (the server is authoritative).
 */

import { Star } from "lucide-react";

export type ChecklistCaptureItem = {
  id: string;
  itemKey: string;
  text: string;
  category: string | null;
  nonNegotiable: boolean;
  naAllowed: boolean;
  sortOrder: number;
};

export type ChecklistCaptureAnswer = "yes" | "no" | "na";

export function IndicatorChecklistCapture({
  defLabel,
  defColor,
  items,
  answers,
  onAnswer,
}: {
  defLabel: string;
  defColor: string;
  items: ChecklistCaptureItem[];
  answers: Record<string, ChecklistCaptureAnswer | undefined>;
  /** answer === undefined clears the item (toggle-off). */
  onAnswer: (item: ChecklistCaptureItem, answer: ChecklistCaptureAnswer | undefined) => void;
}) {
  // Group by category, preserving the incoming (sortOrder) sequence.
  const groups: { category: string | null; items: ChecklistCaptureItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.category === (it.category ?? null)) last.items.push(it);
    else groups.push({ category: it.category ?? null, items: [it] });
  }

  const answered = items.filter(i => answers[i.id] !== undefined);
  const score = answered.filter(i => answers[i.id] !== "no").length;
  const unanswered = items.length - answered.length;
  const nnFailing = items.filter(i => i.nonNegotiable && answers[i.id] === "no").length;

  return (
    <div className="rounded-lg border border-stone-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border-b border-stone-200">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: defColor }} />
        <span className="text-xs font-medium text-stone-700 flex-1 truncate" title={defLabel}>{defLabel}</span>
        <span className="text-[10px] text-stone-400">tick what you observed</span>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {groups.map((g, gi) => (
          <div key={g.category ?? `group-${gi}`}>
            {g.category && (
              <div className="px-3 py-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-wider bg-stone-50/60 border-b border-stone-100 sticky top-0">
                {g.category}
              </div>
            )}
            {g.items.map(it => {
              const a = answers[it.id];
              return (
                <div key={it.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-50 last:border-b-0">
                  <span className="text-xs text-stone-700 flex-1 leading-snug">
                    {it.text}
                    {it.nonNegotiable && (
                      <Star
                        className="w-3 h-3 text-amber-500 inline-block ml-1 -mt-0.5 fill-amber-400"
                        aria-label="Non-negotiable"
                      />
                    )}
                  </span>
                  <div className="flex rounded-md border border-stone-200 overflow-hidden flex-shrink-0">
                    <SegBtn
                      label="Yes"
                      active={a === "yes"}
                      activeCls="bg-emerald-500 text-white"
                      onClick={() => onAnswer(it, a === "yes" ? undefined : "yes")}
                    />
                    <SegBtn
                      label="No"
                      active={a === "no"}
                      activeCls="bg-red-500 text-white"
                      onClick={() => onAnswer(it, a === "no" ? undefined : "no")}
                    />
                    {it.naAllowed && (
                      <SegBtn
                        label="N/A"
                        active={a === "na"}
                        activeCls="bg-stone-400 text-white"
                        onClick={() => onAnswer(it, a === "na" ? undefined : "na")}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between px-3 py-2 bg-white border-t border-stone-200">
        <span
          className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
            unanswered > 0
              ? "bg-stone-100 text-stone-600"
              : nnFailing > 0
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {score} / {items.length}
        </span>
        <span className="text-[11px] text-stone-400">
          {unanswered > 0
            ? `${unanswered} unanswered`
            : nnFailing > 0
              ? `⚠ ${nnFailing} non-negotiable${nnFailing === 1 ? "" : "s"} failing`
              : "All compliant"}
        </span>
      </div>
    </div>
  );
}

function SegBtn({
  label,
  active,
  activeCls,
  onClick,
}: {
  label: string;
  active: boolean;
  activeCls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 text-[11px] font-medium transition-colors border-r border-stone-200 last:border-r-0 ${
        active ? activeCls : "bg-white text-stone-500 hover:bg-stone-50"
      }`}
    >
      {label}
    </button>
  );
}

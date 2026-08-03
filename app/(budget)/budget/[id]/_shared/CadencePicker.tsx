"use client";

import type { BudgetLineCadence } from "@/app/generated/prisma/client";

/** Lightweight cadence picker — used in both the add-line form and EditRow. */
export default function CadencePicker({
  cadence, plannedMonths, onChange,
}: {
  cadence: BudgetLineCadence;
  plannedMonths: number[];
  onChange: (next: { cadence: BudgetLineCadence; plannedMonths: number[] }) => void;
}) {
  const toggleMonth = (m: number) => {
    const next = plannedMonths.includes(m)
      ? plannedMonths.filter(x => x !== m)
      : [...plannedMonths, m].sort((a, b) => a - b);
    onChange({ cadence, plannedMonths: next });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={cadence}
        onChange={e => {
          const next = e.target.value as BudgetLineCadence;
          // Sensible defaults: monthly clears months, one_time seeds [1], seasonal keeps existing if ≥ 2 else empty.
          const months =
            next === "monthly" ? [] :
            next === "one_time" ? (plannedMonths.length === 1 ? plannedMonths : [1]) :
            (plannedMonths.length >= 2 ? plannedMonths : []);
          onChange({ cadence: next, plannedMonths: months });
        }}
        className="border border-stone-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <option value="monthly">Monthly</option>
        <option value="one_time">One-time</option>
        <option value="seasonal">Seasonal</option>
      </select>
      {cadence === "one_time" && (
        <label className="text-xs text-stone-500 flex items-center gap-1">
          Month
          <input
            type="number" min={1} max={12}
            value={plannedMonths[0] ?? 1}
            onChange={e => {
              const m = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
              onChange({ cadence, plannedMonths: [m] });
            }}
            className="w-12 border border-stone-300 rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
      )}
      {cadence === "seasonal" && (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMonth(m)}
              className={`text-xs px-2 py-1 min-h-8 min-w-8 inline-flex items-center justify-center rounded border ${
                plannedMonths.includes(m)
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-white text-stone-500 border-stone-300 hover:bg-stone-50"
              }`}
            >M{m}</button>
          ))}
          {plannedMonths.length < 2 && (
            <span className="text-[10px] text-amber-600 self-center ml-1">pick ≥ 2 months</span>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Top control bar: zone picker · month stepper · lens segmented control ·
 * view toggle (drill tree / visit heatmap / setup matrix).
 */

import { ChevronLeft, ChevronRight, Layers, MapPin, Users } from "lucide-react";
import type { CommandZoneOption } from "@/lib/operations/command";
import { type CommandLens, type CommandView } from "../useCommandState";
import { monthLabelFull } from "./cells";

const LENS_OPTIONS: { value: CommandLens; label: string; icon: React.ReactNode }[] = [
  { value: "geo", label: "Geography", icon: <MapPin className="w-3 h-3" /> },
  { value: "rp", label: "By RP", icon: <Users className="w-3 h-3" /> },
  { value: "prog", label: "By programme", icon: <Layers className="w-3 h-3" /> },
];

const VIEW_OPTIONS: { value: CommandView; label: string }[] = [
  { value: "tree", label: "Drill-down" },
  { value: "visits", label: "Visit heatmap" },
  { value: "setup", label: "Setup matrix" },
];

function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ScopeBar({
  zones,
  zoneId,
  month,
  lens,
  view,
  onChange,
}: {
  zones: CommandZoneOption[];
  zoneId: string;
  /** null = current month. */
  month: string | null;
  lens: CommandLens;
  view: CommandView;
  onChange: (patch: { zoneId?: string; month?: string | null; lens?: CommandLens; view?: CommandView }) => void;
}) {
  const ym = month ?? currentYm();
  const isCurrent = ym === currentYm();
  const multiCity = new Set(zones.map((z) => z.cityName)).size > 1;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Zone picker */}
      <select
        value={zoneId}
        onChange={(e) => onChange({ zoneId: e.target.value })}
        className="text-sm font-semibold text-stone-800 bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 hover:border-stone-300 focus:outline-none focus:ring-1 focus:ring-sky-300"
      >
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {multiCity && z.cityName ? `${z.cityName} · ${z.name}` : z.name}
          </option>
        ))}
      </select>

      {/* Month stepper */}
      <div className="flex items-center gap-0.5 bg-white border border-stone-200 rounded-lg px-1 py-1">
        <button
          onClick={() => onChange({ month: shiftYm(ym, -1) })}
          className="p-0.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-stone-700 px-1 min-w-[92px] text-center tabular-nums">
          {monthLabelFull(ym)}
        </span>
        <button
          onClick={() => !isCurrent && onChange({ month: shiftYm(ym, 1) === currentYm() ? null : shiftYm(ym, 1) })}
          disabled={isCurrent}
          className="p-0.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Lens */}
      <div className="flex items-center gap-0.5 bg-stone-100 rounded-lg p-0.5">
        {LENS_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange({ lens: o.value })}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              lens === o.value ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {o.icon} {o.label}
          </button>
        ))}
      </div>

      {/* View */}
      <div className="flex items-center gap-0.5 bg-stone-100 rounded-lg p-0.5">
        {VIEW_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange({ view: o.value })}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              view === o.value ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

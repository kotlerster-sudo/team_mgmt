"use client";

/**
 * Small visualization primitives shared by the command-center grid, heatmap
 * and detail panel. Pure presentational — all data arrives pre-computed on
 * CommandRow (lib/operations/command.ts).
 */

import { AlertTriangle, Flame } from "lucide-react";
import type { CommandRow } from "@/lib/operations/command";

// ── Phase ────────────────────────────────────────────────────────────────────

export function PhaseChip({ row }: { row: CommandRow }) {
  const p = row.phase;
  if (p.lifecycle === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> LIVE
      </span>
    );
  }
  if (p.lifecycle === "setting_up") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
        {p.currentPhaseLabel ?? "Setup"}
        {p.currentStep != null && p.totalSteps != null && (
          <span className="font-normal text-amber-600">
            {p.currentStep}/{p.totalSteps}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 border border-stone-200 text-stone-500 px-1.5 py-0.5 text-[10px] font-semibold">
      DONE
    </span>
  );
}

// ── Visit cadence dots ───────────────────────────────────────────────────────

export function VisitDots({ done, required }: { done: number; required: number }) {
  if (required === 0) {
    return done > 0 ? (
      <span className="text-[11px] text-stone-500 tabular-nums">{done} visits</span>
    ) : (
      <span className="text-[11px] text-stone-300">no cadence</span>
    );
  }
  const shown = Math.min(required, 6);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex gap-0.5">
        {Array.from({ length: shown }, (_, i) => (
          <span
            key={i}
            className={`w-2 h-2 rounded-full ${i < Math.min(done, shown) ? "bg-emerald-500" : "border border-stone-300 bg-white"}`}
          />
        ))}
      </span>
      <span className={`text-[11px] tabular-nums ${done >= required ? "text-emerald-600 font-semibold" : "text-stone-500"}`}>
        {done}/{required}
      </span>
    </span>
  );
}

// ── Follow-ups (open count + ageing) ─────────────────────────────────────────

export function ApsCell({ aps }: { aps: CommandRow["aps"] }) {
  if (aps.open === 0) return <span className="text-[11px] text-stone-300">—</span>;
  const hot = aps.overdue > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${hot ? "text-red-600 font-semibold" : "text-stone-600"}`}
      title={`${aps.open} open follow-up${aps.open === 1 ? "" : "s"}${hot ? ` · ${aps.overdue} overdue, oldest ${aps.maxAgeDays}d` : ""}`}
    >
      {hot && <AlertTriangle className="w-3 h-3" />}
      {aps.open}
      {aps.maxAgeDays > 0 && <span className={hot ? "text-red-500" : "text-stone-400"}>· {aps.maxAgeDays}d</span>}
    </span>
  );
}

// ── Setup stuck badge ────────────────────────────────────────────────────────

export function StuckBadge({ setup }: { setup: NonNullable<CommandRow["setup"]> }) {
  const f = setup.front;
  if (!f) return <span className="text-[11px] text-stone-300">—</span>;
  const hot = f.daysOverdue > 0 || f.daysStuck >= 14;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] min-w-0 ${hot ? "text-red-600" : "text-stone-600"}`}
      title={`${f.workstream} · ${f.title}${f.onCriticalPath ? " · on critical path" : ""} · in this step ~${f.daysStuck}d${f.daysOverdue > 0 ? ` · ${f.daysOverdue}d past target` : ""}`}
    >
      {f.onCriticalPath && <Flame className={`w-3 h-3 shrink-0 ${hot ? "text-red-500" : "text-amber-500"}`} />}
      <span className="truncate max-w-[140px]">{f.title}</span>
      <span className={`tabular-nums shrink-0 ${hot ? "font-semibold" : "text-stone-400"}`}>~{f.daysStuck}d</span>
    </span>
  );
}

// ── Indicator chips (top values with delta) ──────────────────────────────────

function Delta({ value, prev }: { value: number; prev: number | null }) {
  if (prev == null || prev === value) return null;
  const up = value > prev;
  return (
    <span className={`text-[9px] ${up ? "text-emerald-600" : "text-red-500"}`}>{up ? "▲" : "▼"}</span>
  );
}

const STALE_DOT: Record<string, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-red-400",
  none: "bg-stone-200",
};

export function IndicatorChips({ indicators, max = 2 }: { indicators: CommandRow["indicators"]; max?: number }) {
  const withData = indicators.filter((i) => i.value != null);
  if (withData.length === 0) return <span className="text-[11px] text-stone-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {withData.slice(0, max).map((i) => (
        <span
          key={i.defId}
          className="inline-flex items-center gap-1 rounded-md bg-stone-50 border border-stone-200 px-1.5 py-0.5"
          title={`${i.label}: ${i.value}${i.unit ?? ""}${i.target != null ? ` / target ${i.target}${i.unit ?? ""}` : ""}${i.sharedFacilityCount > 1 ? ` · settlement-level (${i.sharedFacilityCount} facilities)` : ""}${i.lastCapturedAt ? ` · captured ${new Date(i.lastCapturedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${STALE_DOT[i.staleness]}`} />
          <span className="text-[10px] text-stone-500 max-w-[72px] truncate">{i.label}</span>
          <span className="text-[10px] font-semibold text-stone-700 tabular-nums">
            {i.value}
            {i.unit === "%" ? "%" : ""}
          </span>
          <Delta value={i.value!} prev={i.prevValue} />
          {i.sharedFacilityCount > 1 && <span className="text-[8px] text-stone-400" title="Settlement-level value">S</span>}
        </span>
      ))}
      {withData.length > max && <span className="text-[10px] text-stone-400">+{withData.length - max}</span>}
    </span>
  );
}

// ── Tiny inline sparkline (SVG, no chart lib) ────────────────────────────────

export function Sparkline({
  points,
  width = 96,
  height = 24,
  stroke = "#0ea5e9",
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Month formatting ─────────────────────────────────────────────────────────

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" });
}

export function monthLabelFull(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

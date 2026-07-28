"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, CheckCircle2, Clock, AlertTriangle, CalendarClock, MapPin } from "lucide-react";
import { fmtDate, fmtTime, daysAgo } from "@/app/(app)/home/_lib/helpers";
import type { ClusterBoard as ClusterBoardData, BoardActivity } from "@/lib/operations/oversight";

/**
 * Cluster activity board — Today / Overdue / Upcoming / Happened for one cluster, each a
 * collapsible list of activities across the cluster's centres. Every row shows its centre +
 * owner and links to the read-only centre detail (checklist-grouped). Today/Overdue open by
 * default (what needs attention); Upcoming/Happened collapsed.
 */
export function ClusterBoard({ board }: { board: ClusterBoardData }) {
  const empty = board.today.length + board.overdue.length + board.upcoming.length + board.happened.length === 0;
  return (
    <div className="space-y-3">
      <Bucket title="Today" tone="sky" icon={<Clock className="w-3.5 h-3.5" />} items={board.today} defaultOpen mode="scheduled" />
      <Bucket title="Overdue" tone="red" icon={<AlertTriangle className="w-3.5 h-3.5" />} items={board.overdue} defaultOpen mode="overdue" />
      <Bucket title="Upcoming" tone="stone" icon={<CalendarClock className="w-3.5 h-3.5" />} items={board.upcoming} mode="scheduled" />
      <Bucket title="Happened" tone="emerald" icon={<CheckCircle2 className="w-3.5 h-3.5" />} items={board.happened} mode="happened" />
      {empty && (
        <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
          No activity in this cluster in the last 30 days or the next 60.
        </div>
      )}
    </div>
  );
}

function Bucket({
  title, tone, icon, items, defaultOpen = false, mode,
}: {
  title: string;
  tone: "sky" | "red" | "emerald" | "stone";
  icon: React.ReactNode;
  items: BoardActivity[];
  defaultOpen?: boolean;
  mode: "scheduled" | "overdue" | "happened";
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  const toneText = {
    sky: "text-sky-700", red: "text-red-700", emerald: "text-emerald-700", stone: "text-stone-500",
  }[tone];
  return (
    <section className="rounded-xl border border-stone-200 bg-white/40">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className={toneText}>{icon}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${toneText}`}>{title}</span>
        <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums text-stone-500 bg-stone-100">{items.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2.5">
          {items.map((a) => <Row key={a.id + mode} a={a} mode={mode} />)}
        </div>
      )}
    </section>
  );
}

function Row({ a, mode }: { a: BoardActivity; mode: "scheduled" | "overdue" | "happened" }) {
  const stamp =
    mode === "happened" ? (a.completedAt ? fmtDate(a.completedAt) : "done")
    : mode === "overdue" ? `${daysAgo(a.scheduledAt)}d late`
    : fmtTime(a.scheduledAt);
  const stampCls = mode === "overdue" ? "text-amber-700" : mode === "happened" ? "text-emerald-600" : "text-stone-500";
  return (
    <Link
      href={`/operations/${encodeURIComponent(a.themeKey)}/${a.centreGoalId}?from=oversight`}
      className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 hover:border-stone-300 hover:shadow-sm transition-all"
    >
      <span className={`flex-shrink-0 w-16 text-right text-[11px] font-medium tabular-nums ${stampCls}`}>{stamp}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-800 truncate">{a.title}</p>
        <p className="text-[11px] text-stone-400 truncate flex items-center gap-1">
          <MapPin className="w-2.5 h-2.5" />{a.centreName}
          {a.ownerName && <span className="text-stone-300">· {a.ownerName}</span>}
        </p>
      </div>
    </Link>
  );
}

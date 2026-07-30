"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, User, Loader2, Target } from "lucide-react";
import type { CentrePlan } from "@/lib/operations/plan";
import { buildTodayView, type TodayNode } from "./dueState";
import { DueChip } from "./DueChip";
import { StatusIcon } from "./statusIcon";
import { NodeItems, type SheetChecklist, type SheetFollowUp } from "./NodeItems";

/**
 * The setup-centre default: a tight worklist of only what's due — Overdue + Today sections, each
 * listing due WBS nodes as per-node accordions (collapsed by default; the full plan is a toggle
 * away). Expanding a node lazy-fetches its checklists and completes them through the shared
 * NodeItems / ActivityCard flow. Upcoming / overall live in the WBS view, not here.
 */
export function TodayView({ plan, onOpenPlan }: { plan: CentrePlan; onOpenPlan: () => void }) {
  const router = useRouter();
  const { overdue, today } = buildTodayView(plan);
  const refresh = useCallback(() => router.refresh(), [router]);

  if (overdue.length === 0 && today.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white/60 p-4 text-center space-y-1.5">
        <p className="text-sm font-medium text-stone-700">Nothing due today</p>
        {plan.thisWeek ? (
          <p className="text-xs text-stone-400">
            Next: <span className="tabular-nums">{plan.thisWeek.wbs}</span> {plan.thisWeek.title}
          </p>
        ) : (
          <p className="text-xs text-stone-400">{plan.counts.total === plan.counts.done ? "All nodes complete" : "Nothing overdue or scheduled for today"}</p>
        )}
        <button onClick={onOpenPlan} className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline">
          <Target className="w-3.5 h-3.5" /> Open full plan
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <TodaySection title="Overdue" count={overdue.length} tone="red" nodes={overdue} onChanged={refresh} />
      )}
      {today.length > 0 && (
        <TodaySection title="Today" count={today.length} tone="amber" nodes={today} onChanged={refresh} />
      )}
    </div>
  );
}

function TodaySection({ title, count, tone, nodes, onChanged }: {
  title: string; count: number; tone: "red" | "amber"; nodes: TodayNode[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const labelTone = tone === "red" ? "text-red-600" : "text-amber-700";
  const countTone = tone === "red" ? "text-red-600 bg-red-50 border border-red-200" : "text-amber-700 bg-amber-50 border border-amber-200";
  return (
    <section className="rounded-xl border border-stone-200 bg-white/40">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${labelTone}`}>{title}</span>
        <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums ${countTone}`}>{count}</span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2.5">
          {nodes.map((n) => <TodayNodeRow key={n.pitstopId} node={n} onChanged={onChanged} />)}
        </div>
      )}
    </section>
  );
}

type NodeDetail = { checklists: SheetChecklist[]; followUps: SheetFollowUp[] };

function TodayNodeRow({ node, onChanged }: { node: TodayNode; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/pitstops/${node.pitstopId}/plan-node`).then((r) => (r.ok ? r.json() : null));
    setDetail(d);
    setLoading(false);
  }, [node.pitstopId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) load();
  };
  // After a completion, re-pull this node's items and refresh the underlying plan (progress/status).
  const changed = () => { load(); onChanged(); };

  return (
    <div className="rounded-lg border border-stone-200 bg-white/70">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2 px-2.5 py-2 text-left" aria-expanded={open}>
        <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
        <StatusIcon status={node.status} className="w-4 h-4 shrink-0" />
        <span className="text-[11px] font-semibold text-stone-400 tabular-nums shrink-0">{node.wbs}</span>
        <span className="text-sm font-medium text-stone-800 truncate flex-1 min-w-0">{node.title}</span>
        {node.waitingOnWbs && <span className="text-[10px] text-stone-400 italic shrink-0 hidden sm:inline">waiting on {node.waitingOnWbs}</span>}
        {node.ownerName && (
          <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-stone-400 shrink-0">
            <User className="w-2.5 h-2.5" />{node.ownerName}
          </span>
        )}
        {node.itemsTotal > 0 && <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{node.itemsDone}/{node.itemsTotal}</span>}
        <DueChip due={node.due} />
      </button>
      {open && (
        <div className="border-t border-stone-100 p-2.5 space-y-3">
          {loading || !detail ? (
            <div className="py-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-stone-300" /></div>
          ) : (
            <NodeItems pitstopId={node.pitstopId} checklists={detail.checklists} followUps={detail.followUps} editable={false} onChanged={changed} />
          )}
        </div>
      )}
    </div>
  );
}

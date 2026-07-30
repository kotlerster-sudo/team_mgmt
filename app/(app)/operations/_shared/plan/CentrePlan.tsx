"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Loader2, ListTodo, Network } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { PROGRESS_TAGS, progressTagColor } from "@/lib/progressTags";
import type { CentrePlan as CentrePlanData } from "@/lib/operations/plan";
import { PlanBoard } from "./PlanBoard";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { NodeSheet } from "./NodeSheet";
import { TodayView } from "./TodayView";
import { buildTodayView } from "./dueState";

/**
 * The setup-centre one-page plan. Default view is "Today" — a tight worklist of overdue + due-today
 * nodes (per-node accordions, complete-in-place) so an RP at the centre sees only today's job. The
 * full WBS outline (PlanBoard: workstreams → node cards → dependency rails → milestone, with a
 * "This week" critical-path summary) is a toggle away and is where structural edits live (click a
 * node → NodeSheet). Mutations reuse existing routes, then router.refresh() re-derives the plan.
 */
export function CentrePlan({ plan }: { plan: CentrePlanData }) {
  const router = useRouter();
  const [view, setView] = useState<"today" | "plan">("today");
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTag, setNewTag] = useState<string>(plan.workstreams.find((w) => w.tag !== "Ungrouped")?.tag ?? "");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => router.refresh(), [router]);
  const onOpen = useCallback((pitstopId: string) => setSelected(pitstopId), []);

  // Overdue/today buckets + next-up/waiting hints — computed client-side (local day, IST-safe).
  const todayData = useMemo(() => buildTodayView(plan), [plan]);

  const siblings = plan.workstreams.flatMap((w) => w.nodes).map((n) => ({ pitstopId: n.pitstopId, wbs: n.wbs, title: n.title }));

  const addNode = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      await fetchJson(`/api/goals/${plan.goalId}/pitstops`, { method: "POST", body: JSON.stringify({ title, progressTag: newTag || null }) });
      setNewTitle(""); setAdding(false); refresh();
    } finally { setBusy(false); }
  }, [newTitle, newTag, plan.goalId, refresh]);

  const tagOptions = [...new Set([...plan.workstreams.map((w) => w.tag).filter((t) => t !== "Ungrouped"), ...PROGRESS_TAGS])];

  return (
    <div className="space-y-4">
      {/* View toggle: today worklist ↔ full WBS plan */}
      <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs font-medium">
        <button
          onClick={() => setView("today")}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 ${view === "today" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
        >
          <ListTodo className="w-3.5 h-3.5" /> Today
        </button>
        <button
          onClick={() => setView("plan")}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 ${view === "plan" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
        >
          <Network className="w-3.5 h-3.5" /> Full plan (WBS)
        </button>
      </div>

      {view === "today" ? (
        <TodayView plan={plan} onOpenPlan={() => setView("plan")} />
      ) : (
        <>
          <ThisWeekPanel plan={plan} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {plan.workstreams.map((w) => (
              <span key={w.tag} className="inline-flex items-center gap-1.5 text-[11px] text-stone-500">
                <span className={`w-2 h-2 rounded-full ${progressTagColor(w.tag).filled}`} />
                {w.index}. {w.label}
              </span>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {editMode && (
                adding ? (
                  <div className="flex items-center gap-1.5">
                    <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNode(); if (e.key === "Escape") setAdding(false); }} placeholder="Node title…" className="px-2 py-1 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-200" />
                    <select value={newTag} onChange={(e) => setNewTag(e.target.value)} className="text-xs border border-stone-200 rounded-lg px-1.5 py-1 text-stone-600">
                      <option value="">Ungrouped</option>
                      {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={addNode} disabled={busy || !newTitle.trim()} className="px-2 py-1 text-sm bg-stone-900 text-white rounded-lg disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}</button>
                    <button onClick={() => setAdding(false)} className="text-xs text-stone-400">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 hover:bg-stone-50"><Plus className="w-3.5 h-3.5" /> Node</button>
                )
              )}
              <button onClick={() => setEditMode((v) => !v)} className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1.5 border ${editMode ? "bg-sky-600 text-white border-sky-600" : "text-stone-700 border-stone-200 hover:bg-stone-50"}`}>
                <Pencil className="w-3.5 h-3.5" /> {editMode ? "Editing" : "Edit"}
              </button>
            </div>
          </div>

          <PlanBoard plan={plan} onOpen={onOpen} nextUpId={todayData.nextUpId} waitingOn={todayData.waitingOn} />

          {selected && (
            <NodeSheet pitstopId={selected} editable={editMode} siblings={siblings} onClose={() => setSelected(null)} onChanged={refresh} />
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Loader2, Trash2, Plus, Check } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { ActivityCard } from "@/app/(app)/home/_shared/ActivityCard";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";

export type SheetChecklist = { id: string; text: string; status: string; checked: boolean; completionType: string; activities: Activity[] };
export type SheetFollowUp = { id: string; title: string; detail: string | null; dueDate: string; priority: string };

/**
 * The completion surface for one WBS node — its checklists (no-activity checkbox OR the shared
 * ActivityCard flow → indicators + follow-ups) plus open follow-ups. Shared by the slide-over
 * NodeSheet (editable: add/delete sub-items) and the Today worklist accordion (complete-only).
 * Parent owns the plan-node fetch and passes checklists/followUps down; onChanged bubbles up so
 * the parent can reload after any mutation.
 */
export function NodeItems({ pitstopId, checklists, followUps, editable, onChanged }: {
  pitstopId: string;
  checklists: SheetChecklist[];
  followUps: SheetFollowUp[];
  editable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState("");

  const addSubItem = async () => {
    const text = newItem.trim(); if (!text) return;
    setBusy(true);
    try { await fetchJson(`/api/pitstops/${pitstopId}/checklist`, { method: "POST", body: JSON.stringify({ text }) }); setNewItem(""); onChanged(); }
    finally { setBusy(false); }
  };
  const deleteSubItem = async (itemId: string) => {
    try { await fetchJson(`/api/checklist/${itemId}`, { method: "DELETE" }); onChanged(); } catch { /* surfaced elsewhere */ }
  };
  const checkSubItem = async (itemId: string, checked: boolean) => {
    try { await fetchJson(`/api/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify({ checked }) }); onChanged(); } catch { /* */ }
  };
  const closeFollowUp = async (id: string) => {
    try { await fetch(`/api/action-points/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); onChanged(); } catch { /* */ }
  };

  return (
    <>
      {/* Sub-items (checklists → activities) */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Sub-items</p>
        {checklists.length === 0 && <p className="text-xs text-stone-400 italic">No sub-items yet.</p>}
        {checklists.map((c) => (
          <div key={c.id} className="rounded-lg border border-stone-200 bg-stone-50/40 p-2">
            <div className="flex items-center gap-2 px-1 pb-1">
              {c.activities.length === 0 && (
                <button
                  onClick={() => checkSubItem(c.id, c.status !== "Done")}
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${c.status === "Done" ? "bg-emerald-500 border-emerald-500 text-white" : "border-stone-300 bg-white"}`}
                >
                  {c.status === "Done" && <Check className="w-3 h-3" />}
                </button>
              )}
              <span className={`text-[13px] font-medium flex-1 min-w-0 ${c.status === "Done" ? "text-stone-400 line-through" : "text-stone-800"}`}>{c.text}</span>
              {editable && <button onClick={() => deleteSubItem(c.id)} className="text-stone-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
            {c.activities.length > 0 && (
              <div className="space-y-1.5">
                {c.activities.map((a) => (
                  <ActivityCard
                    key={a.id}
                    activity={a}
                    linkedChecklist={{ id: c.id, completionType: c.completionType } as ChecklistItem}
                    onCompleted={onChanged}
                    onRescheduled={onChanged}
                    isDone={a.status === "Done"}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {editable && (
          <div className="flex items-center gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSubItem(); }}
              placeholder="Add a sub-item…"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-200"
            />
            <button onClick={addSubItem} disabled={busy || !newItem.trim()} className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      {/* Follow-ups */}
      {followUps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">Follow-ups</p>
          {followUps.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
              <span className="text-sm text-stone-700 flex-1 min-w-0 truncate">{f.title}</span>
              <button onClick={() => closeFollowUp(f.id)} className="text-xs bg-stone-900 text-white rounded px-2 py-1 hover:bg-stone-700 shrink-0">Close</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

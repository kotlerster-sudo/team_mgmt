"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Flag, Trash2, Plus, Check, GitBranch } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { ActivityCard } from "@/app/(app)/home/_shared/ActivityCard";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";
import { PROGRESS_TAGS, progressTagColor } from "@/lib/progressTags";

type SheetChecklist = { id: string; text: string; status: string; checked: boolean; completionType: string; activities: Activity[] };
type SheetFollowUp = { id: string; title: string; detail: string | null; dueDate: string; priority: string };
type NodeDetail = {
  id: string; goalId: string; title: string; status: string; progressTag: string | null; isMilestone: boolean;
  checklists: SheetChecklist[]; followUps: SheetFollowUp[]; blockedBy: { id: string; title: string; status: string }[];
};

/**
 * Slide-over for one WBS node: complete its sub-items via the shared ActivityCard flow (→ indicators
 * + follow-ups), close follow-ups, and (when editable) rename / set workstream / toggle milestone /
 * add-delete sub-items / delete the node. Every mutation reuses an existing route, then refreshes the
 * plan. Rendered under the page's operations.theme_portal surface so completions pass RBAC.
 */
export function NodeSheet({ pitstopId, editable, onClose, onChanged }: {
  pitstopId: string; editable: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [newItem, setNewItem] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/pitstops/${pitstopId}/plan-node`).then((r) => (r.ok ? r.json() : null));
    setDetail(d);
    if (d) setTitleDraft(d.title);
    setLoading(false);
  }, [pitstopId]);
  useEffect(() => { load(); }, [load]);

  // Refetch this sheet + refresh the underlying plan (status/icons/critical-path recompute server-side).
  const changed = () => { load(); onChanged(); };

  const patchNode = async (data: Record<string, unknown>) => {
    setBusy("node");
    try { await fetchJson(`/api/pitstops/${pitstopId}`, { method: "PATCH", body: JSON.stringify(data) }); changed(); }
    finally { setBusy(null); }
  };
  const renameNode = () => { const t = titleDraft.trim(); if (t && t !== detail?.title) patchNode({ title: t }); };
  const deleteNode = async () => {
    if (!confirm("Delete this node and its sub-items?")) return;
    setBusy("delete");
    try { await fetchJson(`/api/pitstops/${pitstopId}`, { method: "DELETE" }); onChanged(); onClose(); }
    finally { setBusy(null); }
  };
  const addSubItem = async () => {
    const text = newItem.trim(); if (!text) return;
    setBusy("add");
    try { await fetchJson(`/api/pitstops/${pitstopId}/checklist`, { method: "POST", body: JSON.stringify({ text }) }); setNewItem(""); changed(); }
    finally { setBusy(null); }
  };
  const deleteSubItem = async (itemId: string) => {
    try { await fetchJson(`/api/checklist/${itemId}`, { method: "DELETE" }); changed(); } catch { /* surfaced elsewhere */ }
  };
  const checkSubItem = async (itemId: string, checked: boolean) => {
    try { await fetchJson(`/api/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify({ checked }) }); changed(); } catch { /* */ }
  };
  const closeFollowUp = async (id: string) => {
    try { await fetch(`/api/action-points/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); changed(); } catch { /* */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {loading || !detail ? (
          <div className="p-8 text-center text-sm text-stone-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-2">
              {editable ? (
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={renameNode}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="flex-1 min-w-0 text-base font-semibold text-stone-900 border-b border-transparent hover:border-stone-200 focus:border-sky-400 focus:outline-none"
                />
              ) : (
                <h2 className="flex-1 min-w-0 text-base font-semibold text-stone-900">{detail.title}</h2>
              )}
              <button onClick={onClose} className="text-stone-400 hover:text-stone-600 shrink-0"><X className="w-5 h-5" /></button>
            </div>

            {/* Meta row: workstream + milestone */}
            <div className="flex items-center gap-2 flex-wrap">
              {editable ? (
                <select
                  value={detail.progressTag ?? ""}
                  onChange={(e) => patchNode({ progressTag: e.target.value || null })}
                  className="text-xs border border-stone-200 rounded-lg px-2 py-1 text-stone-600"
                >
                  <option value="">Ungrouped</option>
                  {PROGRESS_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                  {detail.progressTag && !(PROGRESS_TAGS as readonly string[]).includes(detail.progressTag) && (
                    <option value={detail.progressTag}>{detail.progressTag}</option>
                  )}
                </select>
              ) : detail.progressTag ? (
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${progressTagColor(detail.progressTag).pill}`}>{detail.progressTag}</span>
              ) : null}
              <button
                disabled={!editable || busy === "node"}
                onClick={() => patchNode({ isMilestone: !detail.isMilestone })}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${detail.isMilestone ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-500 border-stone-200"} ${editable ? "hover:border-stone-400" : "cursor-default"}`}
              >
                <Flag className="w-3 h-3" /> Milestone
              </button>
              <span className="text-[11px] text-stone-400">{detail.status}</span>
            </div>

            {/* Depends on */}
            {detail.blockedBy.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-stone-500">
                <GitBranch className="w-3.5 h-3.5 text-stone-400" /> Needs:
                {detail.blockedBy.map((b) => (
                  <span key={b.id} className={`px-1.5 py-0.5 rounded border ${b.status === "Done" ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-stone-600 border-stone-200"}`}>{b.title}</span>
                ))}
              </div>
            )}

            {/* Sub-items (checklists → activities) */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Sub-items</p>
              {detail.checklists.length === 0 && <p className="text-xs text-stone-400 italic">No sub-items yet.</p>}
              {detail.checklists.map((c) => (
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
                          onCompleted={changed}
                          onRescheduled={changed}
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
                  <button onClick={addSubItem} disabled={busy === "add" || !newItem.trim()} className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 shrink-0">
                    {busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* Follow-ups */}
            {detail.followUps.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">Follow-ups</p>
                {detail.followUps.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                    <span className="text-sm text-stone-700 flex-1 min-w-0 truncate">{f.title}</span>
                    <button onClick={() => closeFollowUp(f.id)} className="text-xs bg-stone-900 text-white rounded px-2 py-1 hover:bg-stone-700 shrink-0">Close</button>
                  </div>
                ))}
              </div>
            )}

            {editable && (
              <button onClick={deleteNode} disabled={busy === "delete"} className="w-full flex items-center justify-center gap-1.5 text-sm text-red-600 border border-red-200 rounded-lg py-2 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> Delete node
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

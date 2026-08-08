"use client";

/**
 * PitstopAPPanel — list of action points for one pitstop, grouped by the
 * activity that raised them. Open/Done tabs, with reopen / mark-done / edit /
 * cancel inline via ActionPointCard.
 *
 * Surfaces inside the Pitstop detail page (under the checklist). Also reused
 * by the Home Today and Follow-ups tab when filtering by a specific pitstop.
 */

import { useEffect, useState } from "react";
import { Check, RefreshCw, ListChecks } from "lucide-react";
import { ActionPointCard } from "./ActionPointCard";
import { MarkAPDoneModal } from "./MarkAPDoneModal";
import { EditAPModal } from "./EditAPModal";
import type { ActionPoint } from "./types";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type Tab = "open" | "done";

export function PitstopAPPanel({
  pitstopId,
  currentUserId,
}: {
  pitstopId: string;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<Tab>("open");
  const [rows, setRows] = useState<ActionPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [doneTarget, setDoneTarget] = useState<ActionPoint | null>(null);
  const [editTarget, setEditTarget] = useState<ActionPoint | null>(null);

  async function load(t: Tab) {
    setLoading(true);
    const res = await fetch(`/api/pitstops/${pitstopId}/action-points?status=${t}`);
    setLoading(false);
    if (res.ok) setRows(await res.json());
    else setRows([]);
  }

  useEffect(() => { load(tab); }, [tab, pitstopId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a per-card state change, replace the row in-place. If the row no
  // longer belongs to the current tab (e.g. just got closed), drop it.
  function handleChanged(next: ActionPoint) {
    setRows(prev => {
      if (!prev) return prev;
      const belongs = (tab === "open" && next.status === "open") || (tab === "done" && next.status === "done");
      if (!belongs) return prev.filter(r => r.id !== next.id);
      return prev.map(r => r.id === next.id ? next : r);
    });
  }

  // Group by raising activity. An activity with zero APs simply doesn't appear
  // in this view — it stays on the checklist row above.
  const grouped = (rows ?? []).reduce<Map<string, { title: string; scheduledAt?: string; items: ActionPoint[] }>>((m, r) => {
    // This panel is fetched by pitstopId, so every row is activity-parented; the
    // fallback only exists because the id is nullable on the model at large.
    const key = r.pitstopEventId ?? "unparented";
    const existing = m.get(key);
    if (existing) existing.items.push(r);
    else m.set(key, {
      title: r.pitstopEvent?.title ?? "(activity)",
      scheduledAt: r.pitstopEvent?.scheduledAt,
      items: [r],
    });
    return m;
  }, new Map());

  const total = rows?.length ?? 0;

  return (
    <SurfaceProvider id="pitstop.ap_panel">
    <div className="border-t border-stone-200 mt-3 pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-stone-400" />
          Follow-ups
          {total > 0 && <span className="text-stone-400 font-normal">{total}</span>}
        </h3>
        <button
          onClick={() => load(tab)}
          className="p-1 text-stone-400 hover:text-stone-600 rounded"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="inline-flex bg-stone-100 rounded-md p-0.5 mb-3 text-xs">
        <button
          onClick={() => setTab("open")}
          className={`px-2.5 py-1 rounded ${tab === "open" ? "bg-white shadow-sm text-stone-800 font-medium" : "text-stone-500"}`}
        >
          Open
        </button>
        <button
          onClick={() => setTab("done")}
          className={`px-2.5 py-1 rounded ${tab === "done" ? "bg-white shadow-sm text-stone-800 font-medium" : "text-stone-500"}`}
        >
          Done
        </button>
      </div>

      {rows === null ? (
        <p className="text-xs text-stone-400 px-1 py-3">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-6 px-2">
          <Check className="w-6 h-6 text-stone-200 mx-auto mb-1.5" />
          <p className="text-xs text-stone-400">
            {tab === "open" ? "No open follow-ups." : "Nothing closed yet."}
          </p>
          {tab === "open" && (
            <p className="text-[10px] text-stone-300 mt-1">
              Add follow-ups when you mark an activity done.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {[...grouped.entries()].map(([eventId, group]) => (
            <div key={eventId}>
              <p className="text-[10px] text-stone-400 mb-1 px-1 truncate">
                ↪ {group.title}
                {group.scheduledAt && (
                  <span className="ml-1.5">· {new Date(group.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                )}
              </p>
              <div className="space-y-1.5">
                {group.items.map(ap => (
                  <ActionPointCard
                    key={ap.id}
                    ap={ap}
                    currentUserId={currentUserId}
                    showContext={false}
                    compact
                    onChanged={handleChanged}
                    onOpenComplete={setDoneTarget}
                    onOpenEdit={setEditTarget}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {doneTarget && (
        <MarkAPDoneModal
          ap={doneTarget}
          onClose={() => setDoneTarget(null)}
          onDone={(next) => { setDoneTarget(null); handleChanged(next); }}
        />
      )}
      {editTarget && (
        <EditAPModal
          ap={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(next) => { setEditTarget(null); handleChanged(next); }}
        />
      )}
    </div>
    </SurfaceProvider>
  );
}

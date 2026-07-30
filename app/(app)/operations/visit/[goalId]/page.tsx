"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, MapPin, CheckCircle2, Repeat, AlertTriangle, Loader2, Plus,
} from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { ActivityCard } from "@/app/(app)/home/_shared/ActivityCard";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";

// A tagged checklist and its activities (the completion units). Materialised post-arrival.
type Checklist = {
  key: string; text: string; completionType: string;
  checklistId: string | null;
  mandatory: boolean; source: string; approval: string | null;
  activities: Activity[];
  doneCount: number; totalCount: number;
};
type Category = { key: string; label: string; checklists: Checklist[] };
type Screen = {
  goal: { id: string; title: string; clusterName: string | null; settlementName: string | null };
  cadence: { count: number; period: string } | null;
  monthRequired: number;
  monthDone: number;
  currentVisit: { id: string; arrivedAt: string | null } | null;
  categories: Category[];
};

export default function VisitPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = use(params);
  const router = useRouter();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [closeMissing, setCloseMissing] = useState<{ text: string; categoryLabel: string }[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [addingCat, setAddingCat] = useState<string | null>(null);
  const [newText, setNewText] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/operations/visit/${goalId}`);
    if (res.ok) setScreen(await res.json());
    else setError((await res.json().catch(() => ({})))?.error ?? "Failed to load");
    setLoading(false);
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  const arrived = Boolean(screen?.currentVisit?.arrivedAt);
  const visitId = screen?.currentVisit?.id ?? null;

  const startOrArrive = async () => {
    setBusy("arrive");
    await fetch(`/api/operations/visit/${goalId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ arrive: true }),
    });
    await load();
    setBusy(null);
  };

  const addItem = async (categoryKey: string) => {
    const text = newText.trim();
    if (!text) return;
    setBusy(`add-${categoryKey}`);
    const res = await fetch(`/api/operations/visit/${goalId}/add-item`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKey, text }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({})))?.error ?? "Couldn't add item");
    setBusy(null);
    setNewText("");
    setAddingCat(null);
    await load();
  };

  const close = async (withReason?: string) => {
    if (!visitId) return;
    setBusy("close");
    const res = await fetch(`/api/pitstop-events/${visitId}/close`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withReason ? { reason: withReason } : {}),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (data?.needsReason) {
      setCloseMissing(data.missing ?? []);
      return;
    }
    router.push("/operations");
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-stone-400 text-center">Loading…</div>;
  }
  if (!screen) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="text-sm text-stone-500">{error || "This centre isn't live."}</p>
        <Link href="/operations" className="text-sm text-sky-600 hover:underline mt-3 inline-block">← Operations</Link>
      </div>
    );
  }

  const allChecklists = screen.categories.flatMap((c) => c.checklists);
  const totalItems = allChecklists.reduce((n, c) => n + c.totalCount, 0);
  const doneItems = allChecklists.reduce((n, c) => n + c.doneCount, 0);

  return (
    <SurfaceProvider id="operations.visit">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link href="/operations" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-stone-900 truncate">{screen.goal.title}</h1>
            <p className="text-xs text-stone-400">
              {screen.goal.clusterName ?? "—"}{screen.goal.settlementName ? ` · ${screen.goal.settlementName}` : ""}
            </p>
          </div>
          {screen.cadence && (
            <span className="flex items-center gap-1 text-xs text-sky-600 shrink-0" title="Visits done this month / required">
              <Repeat className="w-3.5 h-3.5" /> {screen.monthDone}/{screen.monthRequired}
            </span>
          )}
        </div>

        {/* Arrival gate — when there's no open visit but this centre has already been visited this
            month, show a "done for now / log another" card instead of a bare arrival prompt so a
            close reads as progress rather than looking like nothing happened. */}
        {!arrived ? (
          !screen.currentVisit && screen.monthDone > 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  Visited {screen.monthDone}{screen.monthRequired ? `/${screen.monthRequired}` : ""} time{screen.monthDone === 1 ? "" : "s"} this month
                </p>
                <p className="text-xs text-emerald-700/80 mt-0.5">
                  {screen.monthRequired && screen.monthDone >= screen.monthRequired
                    ? "Cadence met for this month — you're all set."
                    : "Come back for the next visit, or log another now if you're here again."}
                </p>
              </div>
              <button
                onClick={startOrArrive}
                disabled={busy === "arrive"}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-emerald-300 text-emerald-800 rounded-xl font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                {busy === "arrive" ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
                Log another visit
              </button>
            </div>
          ) : (
            <button
              onClick={startOrArrive}
              disabled={busy === "arrive"}
              className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-sky-600 text-white rounded-2xl font-medium hover:bg-sky-700 transition-colors disabled:opacity-50"
            >
              {busy === "arrive" ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
              I have reached
            </button>
          )
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-stone-400">{doneItems}/{totalItems} done this visit</span>
              <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Reached
              </span>
            </div>

            {/* Category tiles → checklist headers → their activities (standard ActivityCard flow) */}
            <div className="space-y-2">
              {screen.categories.map((cat) => {
                const catDone = cat.checklists.reduce((n, c) => n + c.doneCount, 0);
                const catTotal = cat.checklists.reduce((n, c) => n + c.totalCount, 0);
                const isOpen = openCat === cat.key;
                return (
                  <div key={cat.key} className="border border-stone-200 rounded-xl bg-white overflow-hidden">
                    <button
                      onClick={() => setOpenCat(isOpen ? null : cat.key)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-stone-800 flex-1 truncate">{cat.label}</span>
                      <span className="text-xs text-stone-400">{catDone}/{catTotal}</span>
                      <ChevronRight className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-stone-100 p-2 space-y-2.5">
                        {cat.checklists.map((cl) => (
                          <ChecklistBlock key={cl.key} checklist={cl} onChanged={load} />
                        ))}

                        {/* Add an off-catalog item — opens a pending approval; materialises on reload. */}
                        {addingCat === cat.key ? (
                          <div className="flex items-center gap-2 px-1 py-1">
                            <input
                              autoFocus
                              value={newText}
                              onChange={(e) => setNewText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.key); if (e.key === "Escape") { setAddingCat(null); setNewText(""); } }}
                              placeholder="New item…"
                              className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                            />
                            <button
                              onClick={() => addItem(cat.key)}
                              disabled={busy === `add-${cat.key}` || !newText.trim()}
                              className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 shrink-0"
                            >
                              {busy === `add-${cat.key}` ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
                            </button>
                            <button onClick={() => { setAddingCat(null); setNewText(""); }} className="text-xs text-stone-400 hover:text-stone-600 shrink-0">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingCat(cat.key); setNewText(""); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-stone-400 hover:text-stone-600 hover:bg-stone-50 rounded-lg transition-colors"
                          >
                            <Plus className="w-4 h-4 shrink-0" /> Add item
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {screen.categories.length === 0 && (
                <p className="text-sm text-stone-400 italic text-center py-8">No catalog categories for this centre yet.</p>
              )}
            </div>

            {/* Close */}
            <button
              onClick={() => close()}
              disabled={busy === "close"}
              className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {busy === "close" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              Close visit
            </button>
          </>
        )}

        {/* Soft-warn reason modal */}
        {closeMissing && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setCloseMissing(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <h2 className="text-sm font-semibold text-stone-800">Mandatory items not done</h2>
              </div>
              <ul className="text-xs text-stone-500 space-y-1 mb-3 list-disc pl-5">
                {closeMissing.map((m, i) => <li key={i}>{m.text} <span className="text-stone-300">· {m.categoryLabel}</span></li>)}
              </ul>
              <p className="text-xs text-stone-400 mb-2">Give a reason to close anyway:</p>
              <textarea
                rows={2}
                className="w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 mb-3"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Ran out of time — will cover next visit"
              />
              <div className="flex gap-2">
                <button onClick={() => setCloseMissing(null)} className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50">
                  Keep going
                </button>
                <button
                  onClick={() => { setCloseMissing(null); close(reason || "No reason given"); }}
                  className="flex-1 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  Close anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SurfaceProvider>
  );
}

/**
 * A tagged checklist inside a visit: a header line, then its activities. Each activity completes
 * through the shared ActivityCard — honouring its completionType (mark-done / voice / upload) and
 * opening CompleteActivityModal for indicators (bound to this checklist) + the follow-up prompt.
 */
function ChecklistBlock({ checklist, onChanged }: { checklist: Checklist; onChanged: () => void }) {
  const allDone = checklist.totalCount > 0 && checklist.doneCount === checklist.totalCount;
  // Voice / Upload mark only the ChecklistItem Done server-side. The per-visit done-count + close
  // check read the child EVENT status, so stamp the completed activity Done here too.
  const handleCompleted = async (eventId: string) => {
    if (checklist.completionType === "Voice" || checklist.completionType === "Upload") {
      await fetch(`/api/pitstop-events/${eventId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Done" }),
      }).catch(() => {});
    }
    onChanged();
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-2">
      <div className="flex items-center gap-2 px-1 pb-1.5">
        {allDone
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          : <span className="w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0" />}
        <span className={`text-[13px] font-medium flex-1 min-w-0 truncate ${allDone ? "text-stone-400" : "text-stone-800"}`}>{checklist.text}</span>
        {checklist.approval === "pending" && (
          <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full shrink-0">pending</span>
        )}
        {checklist.mandatory && !allDone && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full shrink-0">required</span>
        )}
        {checklist.totalCount > 1 && (
          <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{checklist.doneCount}/{checklist.totalCount}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {checklist.activities.length === 0 ? (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-stone-200 bg-white">
            <span className="text-sm text-stone-500 flex-1">{checklist.text}</span>
          </div>
        ) : checklist.activities.map((a) => (
          <ActivityCard
            key={a.id}
            activity={a}
            linkedChecklist={checklist.checklistId ? ({ id: checklist.checklistId, completionType: checklist.completionType } as ChecklistItem) : null}
            onCompleted={handleCompleted}
            onRescheduled={onChanged}
            isDone={a.status === "Done"}
          />
        ))}
      </div>
    </div>
  );
}

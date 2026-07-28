"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, MapPin, CheckCircle2, Circle, Repeat, AlertTriangle, Loader2, Plus,
} from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type Item = { key: string; text: string; completionType: string; mandatory: boolean; source: string; ticked: boolean; approval: string | null };
type Category = { key: string; label: string; items: Item[] };
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

  const tick = async (item: Item) => {
    if (!visitId || item.ticked) return;
    setBusy(item.key);
    await fetch(`/api/pitstop-events/${visitId}/tick-item`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemKey: item.key }),
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

  const totalItems = screen.categories.reduce((n, c) => n + c.items.length, 0);
  const tickedItems = screen.categories.reduce((n, c) => n + c.items.filter((i) => i.ticked).length, 0);

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

        {/* Arrival gate */}
        {!arrived ? (
          <button
            onClick={startOrArrive}
            disabled={busy === "arrive"}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-sky-600 text-white rounded-2xl font-medium hover:bg-sky-700 transition-colors disabled:opacity-50"
          >
            {busy === "arrive" ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
            I have reached
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-stone-400">{tickedItems}/{totalItems} done this visit</span>
              <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Reached
              </span>
            </div>

            {/* Category tiles */}
            <div className="space-y-2">
              {screen.categories.map((cat) => {
                const done = cat.items.filter((i) => i.ticked).length;
                const isOpen = openCat === cat.key;
                return (
                  <div key={cat.key} className="border border-stone-200 rounded-xl bg-white overflow-hidden">
                    <button
                      onClick={() => setOpenCat(isOpen ? null : cat.key)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-stone-800 flex-1 truncate">{cat.label}</span>
                      <span className="text-xs text-stone-400">{done}/{cat.items.length}</span>
                      <ChevronRight className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-stone-100 divide-y divide-stone-50">
                        {cat.items.map((item) => (
                          <button
                            key={item.key}
                            onClick={() => tick(item)}
                            disabled={item.ticked || busy === item.key}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-50 transition-colors disabled:cursor-default"
                          >
                            {busy === item.key ? (
                              <Loader2 className="w-4 h-4 text-stone-400 animate-spin shrink-0" />
                            ) : item.ticked ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 text-stone-300 shrink-0" />
                            )}
                            <span className={`text-sm flex-1 ${item.ticked ? "text-stone-400 line-through" : "text-stone-700"}`}>
                              {item.text}
                            </span>
                            {item.approval === "pending" && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full shrink-0">pending approval</span>
                            )}
                            {item.mandatory && !item.ticked && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full shrink-0">required</span>
                            )}
                          </button>
                        ))}

                        {/* Add an off-catalog item — opens a pending approval for a supervisor. */}
                        {addingCat === cat.key ? (
                          <div className="flex items-center gap-2 px-4 py-2.5">
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
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-colors"
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

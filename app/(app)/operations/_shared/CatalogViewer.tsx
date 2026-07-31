"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Loader2, ClipboardList, MapPin } from "lucide-react";
import type { CentreCatalogView } from "@/lib/operations/catalogView";
import { CadenceEditor } from "./CadenceEditor";

/**
 * Read-only visit catalog for a live centre, shown on the centre-detail page so the catalog
 * is discoverable outside an in-progress visit. Each category is collapsible; items badge
 * their source (added) and approval (pending). Includes a "Log a visit" entry into the tick
 * flow and an "Add item" control that works anytime (→ pending approval via the add-item route).
 */
export function CatalogViewer({ goalId, live, readOnly = false }: { goalId: string; live: NonNullable<CentreCatalogView["live"]>; readOnly?: boolean }) {
  const router = useRouter();
  const behind = live.monthRequired > 0 && live.monthDone < live.monthRequired;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" /> Visit catalog
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <CadenceEditor goalId={goalId} count={live.cadence?.count ?? null} period={live.cadence?.period ?? null} readOnly={readOnly} />
          {live.cadence && (
            <span className={`inline-flex items-center gap-1 text-xs ${behind ? "text-amber-600 font-medium" : "text-stone-400"}`} title="Visits done / required this month">
              {live.monthDone}/{live.monthRequired} this month
            </span>
          )}
          <Link
            href={`/operations/visit/${goalId}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-sky-700"
          >
            <MapPin className="w-3.5 h-3.5" /> Log a visit
          </Link>
        </div>
      </div>

      <div className="space-y-1.5">
        {live.categories.length === 0 && (
          <p className="text-sm text-stone-400 italic text-center py-6 rounded-xl border border-dashed border-stone-200">
            No catalog items yet.
          </p>
        )}
        {live.categories.map((cat) => (
          <CategoryCard key={cat.key} goalId={goalId} cat={cat} onChanged={() => router.refresh()} />
        ))}
      </div>
    </section>
  );
}

function CategoryCard({
  goalId, cat, onChanged,
}: {
  goalId: string;
  cat: NonNullable<CentreCatalogView["live"]>["categories"][number];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/operations/visit/${goalId}/add-item`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKey: cat.key, text: t }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Couldn't add item");
      setBusy(false);
      return;
    }
    setText(""); setAdding(false); setBusy(false);
    onChanged();
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDown className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="text-sm font-medium text-stone-800 flex-1 truncate">{cat.label}</span>
        <span className="text-[11px] text-stone-400 tabular-nums">{cat.items.length}</span>
      </button>
      {open && (
        <div className="border-t border-stone-100 divide-y divide-stone-50">
          {cat.items.map((it) => (
            <div key={it.key} className="flex items-center gap-2.5 px-3 py-2">
              <span className="text-sm text-stone-700 flex-1 min-w-0">{it.text}</span>
              {it.source === "added" && it.approval !== "approved" && (
                <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full shrink-0">
                  {it.approval === "pending" ? "pending approval" : "added"}
                </span>
              )}
              {it.mandatory && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full shrink-0">required</span>
              )}
            </div>
          ))}

          {adding ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { setAdding(false); setText(""); } }}
                placeholder="New item…"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
              <button onClick={add} disabled={busy || !text.trim()} className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 shrink-0">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
              </button>
              <button onClick={() => { setAdding(false); setText(""); }} className="text-xs text-stone-400 hover:text-stone-600 shrink-0">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-colors">
              <Plus className="w-4 h-4 shrink-0" /> Add item
            </button>
          )}
          {error && <p className="text-xs text-red-600 px-3 py-1.5">{error}</p>}
        </div>
      )}
    </div>
  );
}

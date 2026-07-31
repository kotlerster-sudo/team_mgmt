"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Repeat, Pencil, Loader2, Check, X } from "lucide-react";

/**
 * Inline editor for a live centre's visit cadence (per-centre override on its CentreCatalog).
 * Renders the current cadence as a chip; a pencil opens a count + period form that PATCHes
 * /api/goals/[goalId]/cadence and refreshes. Read-only (preview / not-owner) shows the chip only.
 */
type Period = "week" | "month";

export function CadenceEditor({
  goalId, count, period, readOnly = false,
}: {
  goalId: string;
  count: number | null;
  period: Period | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [c, setC] = useState<string>(count != null ? String(count) : "");
  const [p, setP] = useState<Period | "none">(period ?? "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const label = count != null && period ? `${count}× / ${period}` : "No cadence set";

  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/goals/${goalId}/cadence`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: p === "none" ? null : Number(c), period: p === "none" ? null : p }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Couldn't save cadence");
      setBusy(false);
      return;
    }
    setBusy(false);
    setEditing(false);
    router.refresh();
  };

  if (!editing) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${count == null ? "text-amber-600 font-medium" : "text-stone-500"}`}>
        <Repeat className="w-3.5 h-3.5" /> {label}
        {!readOnly && (
          <button onClick={() => setEditing(true)} title="Edit cadence" className="ml-0.5 text-stone-400 hover:text-stone-700">
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <input
        type="number"
        min={1}
        value={c}
        onChange={(e) => setC(e.target.value)}
        disabled={p === "none"}
        placeholder="2"
        className="w-12 px-1.5 py-1 border border-stone-200 rounded-md text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-stone-300 disabled:bg-stone-50 disabled:text-stone-300"
      />
      <span className="text-stone-400">× per</span>
      <select
        value={p}
        onChange={(e) => setP(e.target.value as Period | "none")}
        className="px-1.5 py-1 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-300"
      >
        <option value="month">month</option>
        <option value="week">week</option>
        <option value="none">no cadence</option>
      </select>
      <button
        onClick={save}
        disabled={busy || (p !== "none" && (!c || Number(c) < 1))}
        className="inline-flex items-center rounded-md bg-stone-900 text-white p-1 hover:bg-stone-700 disabled:opacity-40"
        title="Save"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => { setEditing(false); setC(count != null ? String(count) : ""); setP(period ?? "none"); setError(""); }} className="text-stone-400 hover:text-stone-700 p-1" title="Cancel">
        <X className="w-3.5 h-3.5" />
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}

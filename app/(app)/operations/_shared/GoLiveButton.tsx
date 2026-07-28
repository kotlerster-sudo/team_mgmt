"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Loader2 } from "lucide-react";

/**
 * "Take this centre live" — flips a setup centre into visit-driven mode via the go-live route
 * (snapshots the domain catalog, seeds cadence, creates the recurring Operations pitstop).
 * Only rendered by callers for setup centres whose domain has an active catalog. On success
 * the page refreshes and the live catalog viewer takes over.
 */
export function GoLiveButton({ goalId, variant = "full" }: { goalId: string; variant?: "full" | "compact" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/goals/${goalId}/go-live`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Go-live failed");
      setBusy(false);
      return;
    }
    router.refresh();
  };

  if (variant === "compact") {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); go(); }}
        disabled={busy}
        title="Take this centre live"
        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-1 text-[11px] font-medium hover:bg-emerald-100 disabled:opacity-50 shrink-0"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />} Take live
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-900">Ready to run visits?</p>
          <p className="text-xs text-emerald-700/80 mt-0.5">
            Take this centre live to start the monthly visit cadence and catalog.
          </p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
        <button
          onClick={go}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Take live
        </button>
      </div>
    </div>
  );
}

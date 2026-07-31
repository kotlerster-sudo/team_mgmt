"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Loader2 } from "lucide-react";

/**
 * "Take back to setup" — the inverse of Go-live. Flips a live centre to setup mode and retires
 * its visit anchor (stops the cadence). Confirms first, since it takes the centre out of the
 * monthly visit rhythm. The frozen catalog + cadence are kept, so re-going-live is one click.
 */
export function RevertToSetupButton({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const revert = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/goals/${goalId}/revert-setup`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Revert failed");
      setBusy(false);
      return;
    }
    router.refresh();
  };

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700"
        title="Take this centre back to setup mode"
      >
        <Undo2 className="w-3.5 h-3.5" /> Back to setup
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-stone-500">Stop the visit rhythm and return to setup?</span>
      <button
        onClick={revert}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md bg-amber-600 text-white px-2 py-1 font-medium hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Yes, revert
      </button>
      <button onClick={() => { setConfirming(false); setError(""); }} className="text-stone-400 hover:text-stone-700">Cancel</button>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}

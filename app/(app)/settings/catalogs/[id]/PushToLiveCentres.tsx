"use client";

import { useState } from "react";
import { Loader2, X, ArrowUpFromLine, AlertTriangle, CheckCircle } from "lucide-react";

type CentreResult = {
  goalId: string;
  title: string;
  changed: boolean;
  added: string[];
  removed: string[];
  prunedOverrides: string[];
};
type Summary = { catalogSlug: string; needsDomain: string | null; applied: boolean; centres: CentreResult[] };

/**
 * Re-freeze the frozen visit-menu snapshot of every live centre of this catalog's domain from the
 * SAVED catalog. Dry-run preview first, then an explicit Apply. Pushes the saved def — unsaved
 * edits in the editor are not included (the panel says so).
 */
export function PushToLiveCentres({ catalogId, disabled }: { catalogId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  const run = async (apply: boolean) => {
    if (apply) setApplying(true); else setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/admin/catalogs/${catalogId}/refreeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? "Failed"); return; }
      if (apply) setDone(data); else setPreview(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      if (apply) setApplying(false); else setLoading(false);
    }
  };

  const openPanel = () => { setOpen(true); setPreview(null); setDone(null); setErr(""); run(false); };

  const changed = preview?.centres.filter((c) => c.changed) ?? [];
  const doneChanged = done?.centres.filter((c) => c.changed).length ?? 0;

  return (
    <>
      <button
        onClick={openPanel}
        disabled={disabled}
        title={disabled ? "Save the catalog first" : "Re-freeze all live centres of this domain"}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-50"
      >
        <ArrowUpFromLine className="w-4 h-4" /> Push to live centres
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
              <h2 className="text-sm font-semibold text-stone-800 flex-1">Push saved catalog to live centres</h2>
              <button onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              <p className="text-[11px] text-stone-400">
                Re-freezes each live centre&apos;s visit menu from the <b>saved</b> catalog. Save your edits first — unsaved
                changes are not pushed. Already-open visits keep their current items until closed.
              </p>
              {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {err}</p>}

              {done ? (
                <div className="text-sm text-emerald-700 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Applied to {doneChanged} centre(s). {done.centres.length - doneChanged} were already up to date.</span>
                </div>
              ) : loading ? (
                <p className="text-sm text-stone-400 text-center py-6"><Loader2 className="w-4 h-4 animate-spin inline" /> Checking live centres…</p>
              ) : preview ? (
                <>
                  <div className="text-sm text-stone-700">
                    {preview.centres.length} live centre(s) · <b>{changed.length}</b> would change.
                  </div>
                  <div className="space-y-1.5">
                    {changed.map((c) => (
                      <div key={c.goalId} className="border border-stone-200 rounded-lg p-2 text-xs">
                        <div className="font-medium text-stone-800 truncate">{c.title}</div>
                        {c.added.length > 0 && <div className="text-emerald-700 mt-0.5">+ {c.added.join(", ")}</div>}
                        {c.removed.length > 0 && <div className="text-red-600 mt-0.5">− {c.removed.join(", ")}</div>}
                      </div>
                    ))}
                    {changed.length === 0 && <p className="text-xs text-stone-400 italic">All live centres already match the saved catalog.</p>}
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stone-100">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 rounded-lg">
                {done ? "Close" : "Cancel"}
              </button>
              {!done && (
                <button
                  onClick={() => run(true)}
                  disabled={applying || loading || changed.length === 0}
                  className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {applying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Apply to {changed.length} centre{changed.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

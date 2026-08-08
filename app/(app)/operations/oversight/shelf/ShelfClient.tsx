"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Gauge, Loader2, Mic, Paperclip, CircleDot, CheckCircle2 } from "lucide-react";
import { fetchJson, FetchJsonError } from "@/lib/fetchJson";
import type { ShelfRp, ShelfChecklist } from "@/lib/operations/shelf";

/**
 * Three-step deploy flow: pick RP → pick their live centre → select shelf items (optional by
 * default, per-item "required" toggle) → deploy. POSTs to the deploy-items route via fetchJson
 * so the X-Surface header (operations.shelf) rides along for the RBAC surface check.
 *
 * The shelf itself only carries the domain's template checklist items. "Something else" is the
 * escape hatch for a one-off ask the templates don't cover; it deploys with no template ref and
 * so captures no indicator.
 */
export function ShelfClient({ rps }: { rps: ShelfRp[] }) {
  const router = useRouter();
  const [rpId, setRpId] = useState<string | null>(rps.length === 1 ? rps[0].id : null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [freeCompletion, setFreeCompletion] = useState("Activity");
  const [freeRequired, setFreeRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const rp = useMemo(() => rps.find((r) => r.id === rpId) ?? null, [rps, rpId]);
  const centre = useMemo(() => rp?.centres.find((c) => c.goalId === goalId) ?? null, [rp, goalId]);
  const existing = useMemo(() => new Set(centre?.existingKeys ?? []), [centre]);

  const rowKey = (i: ShelfChecklist) => `${i.templateSlug}::${i.checklistKey}`;

  const resetSelection = () => {
    setSelected(new Set()); setRequired(new Set());
    setFreeText(""); setFreeCompletion("Activity"); setFreeRequired(false);
    setDoneMsg(null); setError("");
  };

  const toggle = (i: ShelfChecklist) => {
    const k = rowKey(i);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) { next.delete(k); setRequired((r) => { const rr = new Set(r); rr.delete(k); return rr; }); }
      else next.add(k);
      return next;
    });
  };
  const toggleRequired = (i: ShelfChecklist) => {
    const k = rowKey(i);
    setRequired((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  };

  const freeAsk = freeText.trim();
  const deployCount = selected.size + (freeAsk ? 1 : 0);

  const deploy = async () => {
    if (!centre || deployCount === 0) return;
    setBusy(true); setError(""); setDoneMsg(null);
    const items: {
      templateSlug?: string; checklistKey?: string;
      text: string; completionType: string; required: boolean;
    }[] = (centre.shelf.flatMap((g) => g.items))
      .filter((i) => selected.has(rowKey(i)))
      .map((i) => ({
        templateSlug: i.templateSlug,
        checklistKey: i.checklistKey,
        text: i.text,
        completionType: i.completionType,
        required: required.has(rowKey(i)),
      }));
    // No templateSlug — the route omits `ref` for these, so no binding resolves against it.
    if (freeAsk) items.push({ text: freeAsk, completionType: freeCompletion, required: freeRequired });
    try {
      const res = await fetchJson<{ added: number }>(`/api/operations/centres/${centre.goalId}/deploy-items`, {
        method: "POST", body: JSON.stringify({ items }),
      });
      setDoneMsg(`Deployed ${res.added} item${res.added === 1 ? "" : "s"} to ${centre.name}.`);
      resetSelection();
      router.refresh();
    } catch (err) {
      setError(err instanceof FetchJsonError ? err.message : "Could not deploy.");
    } finally {
      setBusy(false);
    }
  };

  // ── Step 1: pick RP ──
  if (!rp) {
    return (
      <Step label="Choose a team member">
        <div className="space-y-1.5">
          {rps.map((r) => (
            <button key={r.id} onClick={() => { setRpId(r.id); resetSelection(); }}
              className="w-full flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-stone-300 hover:shadow-sm">
              <span className="text-sm font-medium text-stone-800 flex-1 truncate">{r.name ?? "Unnamed"}</span>
              <span className="text-[11px] text-stone-400">{r.centres.length} centre{r.centres.length === 1 ? "" : "s"}</span>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
          ))}
        </div>
      </Step>
    );
  }

  // ── Step 2: pick centre ──
  if (!centre) {
    return (
      <Step label={`${rp.name ?? "Team member"} · choose a centre`} onBack={rps.length > 1 ? () => { setRpId(null); resetSelection(); } : undefined}>
        <div className="space-y-1.5">
          {rp.centres.map((c) => (
            <button key={c.goalId} onClick={() => { setGoalId(c.goalId); resetSelection(); }}
              className="w-full flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-stone-300 hover:shadow-sm">
              <span className="text-sm font-medium text-stone-800 flex-1 truncate">{c.name}</span>
              {c.shelf.length === 0 && <span className="text-[10px] text-amber-600">no shelf</span>}
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
          ))}
        </div>
      </Step>
    );
  }

  // ── Step 3: select + deploy ──
  return (
    <Step label={`${centre.name} · pick items`} onBack={() => { setGoalId(null); resetSelection(); }}>
      {doneMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {doneMsg}
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {centre.shelf.length === 0 ? (
        <p className="text-sm text-stone-400 italic py-6 text-center">No template items available for this centre&apos;s domain.</p>
      ) : (
        <div className="space-y-4">
          {centre.shelf.map((g) => (
            <div key={`${g.templateSlug}-${g.pitstopTitle}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                {g.templateName} · {g.pitstopTitle}
              </p>
              <div className="space-y-1.5">
                {g.items.map((i) => {
                  const k = rowKey(i);
                  const onCatalog = existing.has(i.checklistKey);
                  const isSel = selected.has(k);
                  return (
                    <div key={k} className={`rounded-lg border px-3 py-2 ${onCatalog ? "border-stone-100 bg-stone-50/60" : isSel ? "border-sky-300 bg-sky-50/40" : "border-stone-200 bg-white"}`}>
                      <div className="flex items-center gap-2.5">
                        <button
                          disabled={onCatalog}
                          onClick={() => toggle(i)}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${onCatalog ? "border-stone-200 bg-stone-100" : isSel ? "border-sky-500 bg-sky-500 text-white" : "border-stone-300 bg-white"}`}
                          aria-label={isSel ? "Deselect" : "Select"}
                        >
                          {isSel && !onCatalog && <Check className="w-3 h-3" />}
                        </button>
                        <span className={`text-sm flex-1 min-w-0 truncate ${onCatalog ? "text-stone-400" : "text-stone-800"}`}>{i.text}</span>
                        <CompletionChip type={i.completionType} />
                        {i.hasIndicator && <Gauge className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-label="captures an indicator" />}
                        {onCatalog && <span className="text-[10px] text-stone-400 shrink-0">on catalog</span>}
                      </div>
                      {isSel && !onCatalog && (
                        <label className="flex items-center gap-1.5 mt-1.5 ml-6 text-[11px] text-stone-500 cursor-pointer">
                          <input type="checkbox" checked={required.has(k)} onChange={() => toggleRequired(i)} className="accent-amber-500" />
                          Required for visit sign-off
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2.5 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Something else</p>
        <input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Ask for something not on the shelf…"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
        />
        {freeAsk && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
              How it&apos;s closed
              <select
                value={freeCompletion}
                onChange={(e) => setFreeCompletion(e.target.value)}
                className="rounded border border-stone-200 bg-white px-1.5 py-1 text-[11px] text-stone-700 focus:outline-none"
              >
                <option value="Activity">Mark done</option>
                <option value="Voice">Voice</option>
                <option value="Upload">Photo</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-stone-500 cursor-pointer">
              <input type="checkbox" checked={freeRequired} onChange={() => setFreeRequired((v) => !v)} className="accent-amber-500" />
              Required for visit sign-off
            </label>
            <span className="text-[10px] text-stone-400">Captures no indicator.</span>
          </div>
        )}
      </div>

      <button
        onClick={deploy}
        disabled={busy || deployCount === 0}
        className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-stone-900 text-white px-4 py-3 text-sm font-medium hover:bg-stone-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Deploy {deployCount > 0 ? `${deployCount} item${deployCount === 1 ? "" : "s"}` : "items"}
      </button>
    </Step>
  );
}

function CompletionChip({ type }: { type: string }) {
  const map: Record<string, { icon: typeof Mic; label: string }> = {
    Voice: { icon: Mic, label: "Voice" },
    Upload: { icon: Paperclip, label: "Photo" },
    Activity: { icon: CircleDot, label: "Mark done" },
  };
  const { icon: Icon, label } = map[type] ?? map.Activity;
  return (
    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-stone-500 bg-stone-50 border border-stone-200 rounded-full px-1.5 py-0.5 shrink-0">
      <Icon className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

function Step({ label, onBack, children }: { label: string; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="text-xs text-stone-400 hover:text-stone-600">← Back</button>
        )}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</p>
      </div>
      {children}
    </div>
  );
}

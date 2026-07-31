"use client";

/**
 * CompleteActivityModal — replaces the one-click "Done" path on Activity-type
 * checklist completions. Lets the RP capture in one shot:
 *   - Numeric indicators bound to this activity's parent checklist item
 *     (e.g. creche attendance %, footfall, water TDS — see [[visit-scheduling]]
 *     and `lib/captureIndicatorPoints.ts`). 7 templates carry bindings today;
 *     for activities under other templates the block silently doesn't render.
 *   - Follow-up action points the visit threw up (collapsed by default).
 *
 * Submit order — three steps, each must succeed before the next:
 *   1. POST /api/pitstop-events/[id]/indicators (if any values)
 *   2. POST /api/action-points (batch, if any drafts)
 *   3. PATCH /api/pitstop-events/[id] status=Done
 *
 * Failures partway through: surface the error on the modal; whatever was
 * already saved is kept (indicator points + APs are immutable evidence of
 * the visit). The activity stays open until the user retries or cancels.
 *
 * Voice / Upload completion paths bypass this modal entirely. APs and
 * indicators on those activities can be added from the pitstop detail page.
 */

import { useEffect, useState } from "react";
import { X, Plus, Check, Gauge } from "lucide-react";
import { ActionPointInputRows, draftsToPayload } from "./ActionPointInputRows";
import type { ActionPointDraft } from "./types";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import {
  IndicatorChecklistCapture,
  type ChecklistCaptureAnswer,
  type ChecklistCaptureItem,
} from "@/components/indicators/IndicatorChecklistCapture";

type IndicatorBinding = {
  kind: "facility" | "journey";
  bindingId: string;
  numericField: string;
  defId: string;
  defLabel: string;
  defUnit: string | null;
  defColor: string;
  journeyId?: string;
  journeyLabel?: string;
  // Present when the def carries a scored tick-list (e.g. creche 24-point
  // safety) — rendered as per-item Yes/No(/N-A) instead of a numeric input.
  checklistItems?: ChecklistCaptureItem[];
};

export function CompleteActivityModal({
  eventId,
  activityTitle,
  pitstopTitle,
  goalTitle,
  mode = "complete",
  onClose,
  onCompleted,
}: {
  eventId: string;
  activityTitle: string;
  pitstopTitle?: string | null;
  goalTitle?: string | null;
  /**
   * "complete" (default) — Activity-type path: modal owns the PATCH Done.
   * "post-complete" — Voice / Upload / direct-PATCH paths where the activity
   *    has already been closed by an earlier endpoint. Modal skips step 3
   *    (no re-PATCH) but still captures indicators + APs. The Mark-done
   *    button reads "Save" instead of "Mark done".
   */
  mode?: "complete" | "post-complete";
  onClose: () => void;
  /** Called after all save steps succeed (or skipped). The parent should refresh. */
  onCompleted: () => void;
}) {
  const [drafts, setDrafts] = useState<ActionPointDraft[]>([]);
  const [showAPs, setShowAPs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Indicator bindings for this activity's parent checklist item.
  // Lazy-fetched on open — most activities (31/38 templates) have no bindings
  // and we don't want to slow the modal open for them. `null` = not yet
  // fetched; `[]` = fetched, no bindings; populated = render block.
  const [bindings, setBindings] = useState<IndicatorBinding[] | null>(null);
  const [indicatorValues, setIndicatorValues] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch(`/api/pitstop-events/${eventId}/indicators`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: IndicatorBinding[]) => setBindings(rows))
      .catch(() => setBindings([]));
  }, [eventId]);
  function setIndicatorValue(numericField: string, raw: string) {
    setIndicatorValues(prev => ({ ...prev, [numericField]: raw }));
  }

  // Tick-list answers per checklist-carrying binding: numericField →
  // (itemDefId → answer). Score is recomputed server-side; we mirror it
  // client-side for display + the values payload.
  const [checklistAnswers, setChecklistAnswers] = useState<
    Record<string, Record<string, ChecklistCaptureAnswer | undefined>>
  >({});

  function setChecklistAnswer(
    binding: IndicatorBinding,
    item: ChecklistCaptureItem,
    answer: ChecklistCaptureAnswer | undefined,
  ) {
    setChecklistAnswers(prev => ({
      ...prev,
      [binding.numericField]: { ...prev[binding.numericField], [item.id]: answer },
    }));
    // Auto-AP on failed non-negotiables: flipping to "No" appends an editable
    // draft tagged with sourceItemKey; flipping away removes exactly that
    // auto-draft (manual drafts and edits to other rows untouched).
    if (item.nonNegotiable && answer === "no") {
      setDrafts(prev => {
        if (prev.some(d => d.sourceItemKey === item.itemKey)) return prev;
        setShowAPs(true);
        return [...prev, {
          clientId: crypto.randomUUID(),
          pitstopEventId: eventId,
          title: `Fix: ${item.text}${goalTitle ? ` — ${goalTitle}` : ""}`,
          detail: "",
          dueDateYmd: defaultDueYmd(),
          priority: "urgent",
          partnerStaffLabel: "",
          sourceItemKey: item.itemKey,
        }];
      });
    } else if (item.nonNegotiable) {
      setDrafts(prev => prev.filter(d => d.sourceItemKey !== item.itemKey));
    }
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);

    // Tick-list gating: each checklist must be fully answered or fully
    // untouched — a partial checklist would make the /N score ambiguous.
    const answersPayload: Record<string, Record<string, ChecklistCaptureAnswer>> = {};
    for (const b of bindings ?? []) {
      const items = b.checklistItems;
      if (!items || items.length === 0) continue;
      const perItem = checklistAnswers[b.numericField] ?? {};
      const answeredCount = items.filter(i => perItem[i.id] !== undefined).length;
      if (answeredCount === 0) continue; // untouched → skip capture entirely
      if (answeredCount < items.length) {
        setErr(`Answer all ${items.length} items on "${b.defLabel}" or clear the checklist`);
        setSubmitting(false);
        return;
      }
      const clean: Record<string, ChecklistCaptureAnswer> = {};
      for (const i of items) clean[i.id] = perItem[i.id]!;
      answersPayload[b.numericField] = clean;
    }

    // Step 1: capture indicator values (if any non-empty). Coerce strings →
    // numbers; drop empties + non-finites at the boundary so the server doesn't
    // have to second-guess.
    const numericValues: Record<string, number> = {};
    for (const [k, v] of Object.entries(indicatorValues)) {
      if (v === "" || v === undefined || v === null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) numericValues[k] = n;
    }
    // Client-computed scores for completed checklists — display/back-compat;
    // the server recomputes from the answers and its value wins.
    for (const [field, perItem] of Object.entries(answersPayload)) {
      numericValues[field] = Object.values(perItem).filter(a => a !== "no").length;
    }
    if (Object.keys(numericValues).length > 0 || Object.keys(answersPayload).length > 0) {
      const indRes = await fetch(`/api/pitstop-events/${eventId}/indicators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: numericValues, answers: answersPayload }),
      });
      if (!indRes.ok) {
        setErr((await indRes.json().catch(() => ({})))?.error ?? "Couldn't save indicator values");
        setSubmitting(false);
        return;
      }
    }

    // Step 2: save APs if any. Empty payload → skip.
    const payload = draftsToPayload(drafts);
    if (payload.length > 0) {
      const apRes = await fetch("/api/action-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload.map(p => ({ ...p, pitstopEventId: eventId })) }),
      });
      if (!apRes.ok) {
        setErr((await apRes.json().catch(() => ({})))?.error ?? "Couldn't save action points");
        setSubmitting(false);
        return;
      }
    }

    // Step 3: close the activity. Only when the caller owns the close (mode
    // === "complete"). Voice / Upload / direct-PATCH paths run the modal in
    // "post-complete" mode AFTER their own endpoint already flipped the
    // activity to Done — re-PATCHing would be a no-op at best and a status-
    // race at worst.
    if (mode === "complete") {
      const doneRes = await fetch(`/api/pitstop-events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Done" }),
      });
      if (!doneRes.ok) {
        setErr((await doneRes.json().catch(() => ({})))?.error ?? "Couldn't close activity (indicators + action points saved; retry to close).");
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    onCompleted();
  }

  const apCount = drafts.filter(d => d.title.trim().length > 0).length;
  // A fully answered tick-list counts as one filled indicator.
  const completedChecklists = (bindings ?? []).filter(b => {
    const items = b.checklistItems;
    if (!items || items.length === 0) return false;
    const perItem = checklistAnswers[b.numericField] ?? {};
    return items.every(i => perItem[i.id] !== undefined);
  }).length;
  const filledIndicators =
    Object.entries(indicatorValues).filter(([, v]) => v !== "" && Number.isFinite(Number(v))).length +
    completedChecklists;

  return (
    <SurfaceProvider id="activities.complete_modal">
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">
            {mode === "post-complete" ? "Capture details" : "Complete activity"}
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="w-4 h-4 text-stone-400" /></button>
        </div>
        {mode === "post-complete" && (
          <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2.5 py-1 mb-3 inline-block">
            ✓ Activity marked done · capture any indicators or follow-ups below
          </p>
        )}

        <p className="text-sm text-stone-700 leading-snug">{activityTitle}</p>
        {(pitstopTitle || goalTitle) && (
          <p className="text-[11px] text-stone-400 mt-0.5 truncate">
            {[goalTitle, pitstopTitle].filter(Boolean).join(" › ")}
          </p>
        )}

        <div className="mt-4 mb-3 border-t border-stone-100" />

        {/* Indicators — only renders when the parent checklist item has
            bindings (~7 templates today; silent for the rest). Optional fields
            in v1: empty rows are skipped on submit. */}
        {bindings && bindings.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-3 h-3 text-stone-400" />
                Indicators ({bindings.length})
              </h3>
              <p className="text-[11px] text-stone-400">Optional — fill what you observed</p>
            </div>
            <div className="space-y-1.5">
              {bindings.map(b => (
                b.checklistItems && b.checklistItems.length > 0 ? (
                  <IndicatorChecklistCapture
                    key={b.bindingId}
                    defLabel={b.defLabel}
                    defColor={b.defColor}
                    items={b.checklistItems}
                    answers={checklistAnswers[b.numericField] ?? {}}
                    onAnswer={(item, answer) => setChecklistAnswer(b, item, answer)}
                  />
                ) : (
                <div key={b.bindingId} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 bg-stone-50/60">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.defColor }} />
                  <label className="text-xs text-stone-700 flex-1 truncate" title={b.defLabel}>
                    {b.defLabel}
                    {b.kind === "journey" && b.journeyLabel && (
                      <span className="text-[10px] text-stone-400 ml-1.5">↪ {b.journeyLabel}</span>
                    )}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={indicatorValues[b.numericField] ?? ""}
                    onChange={e => setIndicatorValue(b.numericField, e.target.value)}
                    placeholder="—"
                    className="w-24 px-2 py-1 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-sky-400 tabular-nums text-right"
                  />
                  {b.defUnit && (
                    <span className="text-[10px] text-stone-400 w-10 truncate">{b.defUnit}</span>
                  )}
                </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* AP capture — collapsed by default */}
        {!showAPs && drafts.length === 0 ? (
          <button
            type="button"
            onClick={() => { setShowAPs(true); setDrafts([{
              clientId: crypto.randomUUID(),
              pitstopEventId: eventId,
              title: "", detail: "", dueDateYmd: defaultDueYmd(),
              priority: "routine", partnerStaffLabel: "",
            }]); }}
            className="w-full py-2 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-50 border border-dashed border-stone-300 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add follow-up action point
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                Follow-up action points {apCount > 0 && <span className="text-stone-700">({apCount})</span>}
              </h3>
              <p className="text-[11px] text-stone-400">For your follow-up after this visit</p>
            </div>
            <ActionPointInputRows
              drafts={drafts}
              onChange={setDrafts}
              pitstopEventId={eventId}
            />
          </div>
        )}

        {err && <p className="text-xs text-red-600 mt-3">{err}</p>}

        <div className="flex justify-between items-center gap-2 mt-5 pt-3 border-t border-stone-100">
          <p className="text-[11px] text-stone-400">
            {[
              filledIndicators > 0 ? `${filledIndicators} indicator${filledIndicators === 1 ? "" : "s"}` : null,
              apCount > 0 ? `${apCount} follow-up${apCount === 1 ? "" : "s"}` : null,
            ].filter(Boolean).join(" + ") || "No extras."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-3 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-lg flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {submitting ? "Saving…" : mode === "post-complete" ? "Save" : "Mark done"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </SurfaceProvider>
  );
}

function defaultDueYmd(): string {
  const d = new Date(); d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

"use client";

// Lead-side control for the grant-making round-trip: share the draft with the
// grantee, watch for their submission, read what they changed, and either send
// it back with a note or take the draft off them.

import { useState, useTransition } from "react";
import {
  getPartnerDraftDiff, reclaimBudgetDraft, sendBackBudgetDraft, shareBudgetWithPartner,
} from "../partner-draft-actions";
import type { DraftNote } from "../partner-draft-actions";
import type { LineDiff } from "@/lib/budget/partnerDiff";
import LineNoteThread, { openQueryCount } from "./_shared/LineNoteThread";
import type { PartnerDraftState } from "./_shared/types";
import { fmt } from "./_shared/types";

const FIELD_LABELS: Record<string, string> = {
  description: "Description", section: "Section", domain: "Domain", unitType: "Unit",
  y1Units: "Units", y1UnitCost: "Unit cost", y1Total: "Y1 total",
  derivation: "Derivation", workingSignature: "Working",
};

const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

type Budget = PartnerDraftState & { id: string; status: string; grantPartnerId?: string | null };

export default function PartnerDraftPanel({ budget, notesByLine }: {
  budget: Budget;
  notesByLine: Record<string, DraftNote[]>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<LineDiff | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  // Only a draft moves through this cycle. Once finalised there is nothing to share.
  if (budget.status !== "draft" && budget.partnerEditState === "closed") return null;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      try { await fn(); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); }
    });

  const openDiff = () => {
    setDiffOpen(true);
    if (!diff) run(async () => setDiff(await getPartnerDraftDiff(budget.id)));
  };

  const who = budget.grantPartnerName ?? "the grantee";
  const round = budget.partnerRound ?? 0;
  const openQueries = Object.values(notesByLine).flat().filter(n => !n.resolvedAt).length;
  // Line queries carry the substance, so a covering note isn't worth insisting on
  // when some are already open.
  const sendBackBody = note.trim() ||
    (openQueries > 0 ? `See the ${openQueries} line quer${openQueries === 1 ? "y" : "ies"} raised on this budget.` : "");

  return (
    <div className={`rounded-xl border px-4 sm:px-5 py-4 mb-6 ${
      budget.partnerEditState === "submitted" ? "border-amber-200 bg-amber-50"
      : budget.partnerEditState === "open" ? "border-sky-200 bg-sky-50"
      : "border-stone-200 bg-stone-50"
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-800">
            {budget.partnerEditState === "closed" && "Grantee input"}
            {budget.partnerEditState === "open" && `Open with ${who}`}
            {budget.partnerEditState === "submitted" && `${who} submitted this draft`}
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            {budget.partnerEditState === "closed" && (
              budget.grantPartnerId
                ? "Share the draft so they can adjust line items and workings against their own costs. Your own line edits pause while it is with them."
                : "Link a grantee org above before you can share this draft with them."
            )}
            {budget.partnerEditState === "open" && `Shared ${day(budget.partnerSharedAt)}. They can edit lines until they submit.`}
            {budget.partnerEditState === "submitted" && `Submitted ${day(budget.partnerSubmittedAt)}. Read the changes, then send it back or take the draft.`}
            {round > 0 && <span className="ml-1 text-stone-400">· round {round + 1}</span>}
            {openQueries > 0 && <span className="ml-1 font-medium text-amber-700">· {openQueries} open quer{openQueries === 1 ? "y" : "ies"}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {budget.partnerEditState === "closed" && budget.status === "draft" && (
            <button
              onClick={() => run(() => shareBudgetWithPartner(budget.id))}
              disabled={pending || !budget.grantPartnerId}
              className="text-sm bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50">
              Share for their input
            </button>
          )}
          {budget.partnerEditState !== "closed" && (
            <>
              {budget.partnerEditState === "submitted" && (
                <>
                  <button onClick={diffOpen ? () => setDiffOpen(false) : openDiff}
                    className="text-sm border border-stone-300 bg-white px-3 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700">
                    {diffOpen ? "Hide changes" : "Review changes"}
                  </button>
                  <button onClick={() => setNoteOpen(v => !v)}
                    className="text-sm border border-amber-300 bg-white px-3 py-1.5 rounded-lg hover:bg-amber-50 text-amber-700">
                    Send back
                  </button>
                </>
              )}
              <button
                onClick={() => run(() => reclaimBudgetDraft(budget.id))}
                disabled={pending}
                className="text-sm bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-900 disabled:opacity-50">
                Take the draft back
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {noteOpen && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <label className="text-xs text-stone-600">What needs changing?</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="e.g. the coordinator salary is above our band — please bring it to ₹22,000 and show the working."
            className="mt-1 w-full text-sm border border-stone-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500" />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => run(async () => { await sendBackBudgetDraft(budget.id, sendBackBody); setNote(""); setNoteOpen(false); })}
              disabled={pending || !sendBackBody}
              className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50">
              Send back for another round
            </button>
            <button onClick={() => setNoteOpen(false)} className="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
          </div>
        </div>
      )}

      {diffOpen && <DiffView diff={diff} loading={pending && !diff} budgetId={budget.id} notesByLine={notesByLine} />}
    </div>
  );
}

/** A line in the diff, with the query thread the lead raises against it folded
 *  underneath. Removed lines are excluded upstream — the note's line FK has
 *  nothing left to point at. */
function QueryableLine({ budgetId, lineId, notes, children }: {
  budgetId: string; lineId: string; notes: DraftNote[]; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const unresolved = openQueryCount(notes);
  return (
    <li className="text-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button onClick={() => setOpen(v => !v)}
          className={`shrink-0 px-1.5 py-0.5 rounded border ${unresolved > 0 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-white text-stone-500 border-stone-300 hover:text-stone-700"}`}>
          {unresolved > 0 ? `${unresolved} open` : notes.length > 0 ? "queries ✓" : "Query"}
        </button>
      </div>
      {open && (
        <div className="mt-2 mb-3 max-w-2xl">
          <LineNoteThread budgetId={budgetId} budgetLineId={lineId} notes={notes}
            canComment canResolve placeholder="What should they change on this line?" />
        </div>
      )}
    </li>
  );
}

function DiffView({ diff, loading, budgetId, notesByLine }: {
  diff: LineDiff | null; loading: boolean;
  budgetId: string; notesByLine: Record<string, DraftNote[]>;
}) {
  if (loading) return <p className="mt-3 text-xs text-stone-500">Loading changes…</p>;
  if (!diff) return <p className="mt-3 text-xs text-stone-500">No baseline was captured for this draft.</p>;

  const untouched = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
  if (untouched) return <p className="mt-3 text-xs text-stone-500">They submitted it unchanged.</p>;

  const val = (v: unknown) => v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN") : String(v);

  return (
    <div className="mt-3 border-t border-amber-200 pt-3 space-y-3">
      <div className="text-xs text-stone-600">
        {diff.added.length} added · {diff.removed.length} removed · {diff.changed.length} changed ·
        <span className={`ml-1 font-medium ${diff.y1Delta > 0 ? "text-red-600" : diff.y1Delta < 0 ? "text-emerald-700" : "text-stone-600"}`}>
          Y1 {diff.y1Delta >= 0 ? "+" : "−"}{fmt(Math.abs(diff.y1Delta))}
        </span>
      </div>

      {diff.added.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-emerald-700 mb-1">Added</div>
          <ul className="space-y-0.5">
            {diff.added.map(l => (
              <QueryableLine key={l.id} budgetId={budgetId} lineId={l.id} notes={notesByLine[l.id] ?? []}>
                <span className="text-stone-700">{l.description}</span> <span className="text-stone-400">· {fmt(l.y1Total)}</span>
              </QueryableLine>
            ))}
          </ul>
        </div>
      )}

      {diff.removed.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-700 mb-1">Removed</div>
          <ul className="space-y-0.5">
            {diff.removed.map(l => (
              <li key={l.id} className="text-xs text-stone-700 line-through decoration-stone-300">{l.description} <span className="text-stone-400 no-underline">· {fmt(l.y1Total)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {diff.changed.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-stone-700 mb-1">Changed</div>
          <ul className="space-y-1.5">
            {diff.changed.map(c => (
              <QueryableLine key={c.after.id} budgetId={budgetId} lineId={c.after.id} notes={notesByLine[c.after.id] ?? []}>
                <div className="text-stone-800">{c.after.description}</div>
                <ul className="mt-0.5 ml-3 space-y-0.5">
                  {c.fields.map(f => (
                    <li key={f.field} className="text-stone-500">
                      {FIELD_LABELS[f.field] ?? f.field}:{" "}
                      {f.field === "workingSignature"
                        ? <span className="text-stone-600">rewritten</span>
                        : <><span className="line-through decoration-stone-300">{val(f.before)}</span> → <span className="text-stone-800">{val(f.after)}</span></>}
                    </li>
                  ))}
                </ul>
              </QueryableLine>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

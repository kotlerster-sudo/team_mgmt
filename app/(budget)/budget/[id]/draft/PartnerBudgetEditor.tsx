"use client";

// The grantee's view of a shared draft. Same rows and same server actions as the
// internal editor — what differs is the chrome: no grantee/lead assignment, no
// delivery-partner tabs, no Finalize, no Analysis, and a Submit button instead.

import { useState, useTransition } from "react";
import { submitBudgetDraft, type DraftNote } from "../../partner-draft-actions";
import type { BudgetSection } from "@/app/generated/prisma/client";
import BudgetLineTable, { type NewLineInput } from "../_shared/BudgetLineTable";
import { TotalCell } from "../_shared/LineRows";
import { useBudgetLines } from "../_shared/useBudgetLines";
import {
  type BandKey, type BudgetCore, type PartnerDraftState,
  DOMAIN_LABELS, SECTION_ORDER, computeBands, hasCountInputs, horizonLabel, inflationRates, yTotalKey,
} from "../_shared/types";

type Budget = BudgetCore & PartnerDraftState;

export default function PartnerBudgetEditor({ budget, notes, notesByLine, editable }: {
  budget: Budget;
  notes: DraftNote[];
  notesByLine: Record<string, DraftNote[]>;
  editable: boolean;
}) {
  const domainLabels: Record<string, string> = budget.domainLabels ?? DOMAIN_LABELS;
  const bands = computeBands(budget.horizonMonths ?? budget.years * 12, budget.partialPosition ?? "end");
  const inflationRate = inflationRates(budget);
  const showAlloc = bands.length > 1;

  const [activeTab, setActiveTab] = useState<string>("master");
  const [submitPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { lines, working, pending, error, saveLine, removeLine, appendLine, saveWorking } =
    useBudgetLines(budget.id, budget.lines, budget.workingByLineId ?? {});

  const visibleLines = activeTab === "master"
    ? lines
    : lines.filter(l => l.domain === activeTab || l.domain === null);

  const grouped = SECTION_ORDER.map(sec => ({
    section: sec,
    lines: visibleLines.filter(l => l.section === sec),
  })).filter(g => g.lines.length > 0 || (editable && ["admin_salary", "admin_other", "additional"].includes(g.section)));

  const grandTotal = (k: BandKey) => visibleLines.reduce((s, l) => s + l[yTotalKey(k)], 0);
  const horizonTotal = () => bands.reduce((s, b) => s + grandTotal(b.k), 0);
  const hasInputs = hasCountInputs(budget.inputs);
  const grandTotalLabel = activeTab === "master" ? "All domains" : (domainLabels[activeTab] ?? activeTab);

  const handleAdd = (section: BudgetSection, input: NewLineInput) => appendLine(section, input, null);

  const submit = () =>
    startTransition(async () => {
      try { await submitBudgetDraft(budget.id); setSubmitError(null); }
      catch (e) { setSubmitError(e instanceof Error ? e.message : "That didn't submit. Please try again."); }
    });

  // Latest round first — the note that sent this draft back is the one to read.
  const sortedNotes = [...notes].sort((a, b) => b.round - a.round);
  const openLineQueries = Object.values(notesByLine).flat().filter(n => !n.resolvedAt).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-stone-900">{budget.name}</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {editable
              ? "Adjust these lines to your own costs — change quantities and unit costs, rewrite a working, or add items we've missed."
              : "This budget is with the Foundation. You'll be able to edit it again if they send it back."}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {budget.domains.map(d => <span key={d} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">{domainLabels[d] ?? d}</span>)}
            <span className="text-xs text-stone-400 self-center ml-1">{horizonLabel(budget.horizonMonths ?? budget.years * 12)}</span>
          </div>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-stone-500">Submit to the Foundation? You won’t be able to edit after this.</span>
                <button onClick={submit} disabled={submitPending}
                  className="text-sm bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-60">
                  {submitPending ? "Submitting…" : "Yes, submit"}
                </button>
                <button onClick={() => setConfirming(false)} className="text-xs text-stone-400 hover:text-stone-700">Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)}
                className="text-sm bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700">
                Submit budget
              </button>
            )}
          </div>
        )}
      </div>

      {(sortedNotes.length > 0 || openLineQueries > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 sm:px-5 py-4 mb-6 space-y-3">
          <div className="text-sm font-semibold text-amber-800">From the Foundation</div>
          {openLineQueries > 0 && (
            <p className="text-sm text-amber-800">
              {openLineQueries} unresolved quer{openLineQueries === 1 ? "y" : "ies"} on individual lines — look for the amber chip on the line and reply there.
            </p>
          )}
          {sortedNotes.map(n => (
            <div key={n.id}>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-stone-400 mt-0.5">
                {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · round {n.round}
              </p>
            </div>
          ))}
        </div>
      )}

      {(error || submitError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error ?? submitError}</div>
      )}

      {hasInputs && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 sm:px-5 py-4 mb-6 flex flex-wrap gap-x-6 gap-y-3 items-start">
          <div className="self-center w-full sm:w-auto text-xs font-semibold text-sky-700 uppercase tracking-wide sm:min-w-[100px]">
            {grandTotalLabel}
          </div>
          {bands.map(b => <TotalCell key={b.k} label={`${b.label} Total`} value={grandTotal(b.k)} big={b.k === 1} />)}
          {bands.length > 1 && (
            <TotalCell label={`${horizonLabel(budget.horizonMonths ?? budget.years * 12)} Total`} value={horizonTotal()} big />
          )}
        </div>
      )}

      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {(["master", ...budget.domains] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap transition-all ${
              activeTab === tab ? "bg-sky-600 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {tab === "master" ? "All domains" : (domainLabels[tab] ?? tab)}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {grouped.map(({ section, lines: sLines }) => (
          <BudgetLineTable
            key={section}
            budgetId={budget.id}
            section={section}
            lines={sLines}
            bands={bands}
            showAlloc={showAlloc}
            inflationRate={inflationRate}
            domains={budget.domains}
            domainLabels={domainLabels}
            working={working}
            pending={pending}
            canEdit={editable}
            canDelete={editable}
            canAdd={editable}
            showHistory={false}
            notesByLine={notesByLine}
            canComment={budget.partnerEditState !== "closed"}
            defaultDomain={activeTab !== "master" ? activeTab : (budget.domains[0] ?? "")}
            onSaveLine={saveLine}
            onDeleteLine={removeLine}
            onAddLine={handleAdd}
            onSaveWorking={saveWorking}
          />
        ))}
      </div>

      {hasInputs && (
        <div className="mt-6 bg-stone-900 text-white rounded-xl px-5 py-4 flex flex-wrap gap-6 items-start">
          <div className="self-center">
            <div className="text-xs text-stone-400 uppercase tracking-wide">Grand Total</div>
            <div className="text-sm font-semibold text-white">{grandTotalLabel}</div>
          </div>
          {bands.map(b => <TotalCell key={b.k} label={b.label} value={grandTotal(b.k)} big={b.k === 1} white />)}
          {bands.length > 1 && (
            <TotalCell label={`${horizonLabel(budget.horizonMonths ?? budget.years * 12)} Total`} value={horizonTotal()} big white />
          )}
        </div>
      )}
    </div>
  );
}

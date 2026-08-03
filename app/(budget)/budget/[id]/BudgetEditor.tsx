"use client";

// Internal manage view. The rows and their arithmetic live in ./_shared, which
// the grantee's draft view (./draft/PartnerBudgetEditor) renders too; everything
// here is the admin chrome that only a manager sees — grantee/lead assignment,
// delivery-partner tabs, Finalize, Export, Analysis.

import { useState, useTransition } from "react";
import { finalizeBudget, updateBudgetGrantPartner, updateBudgetGrantLead } from "../actions";
import type { BudgetSection } from "@/app/generated/prisma/client";
import BudgetLineTable, { type NewLineInput } from "./_shared/BudgetLineTable";
import { TotalCell } from "./_shared/LineRows";
import PartnerDraftPanel from "./PartnerDraftPanel";
import type { DraftNote } from "../partner-draft-actions";
import { useBudgetLines } from "./_shared/useBudgetLines";
import {
  type BandKey, type BudgetCore, type PartnerDraftState,
  DOMAIN_LABELS, SECTION_ORDER, computeBands, fmt, hasCountInputs, horizonLabel, inflationRates, yTotalKey,
} from "./_shared/types";

type Budget = BudgetCore & {
  importedAt?: string | null;
  grantPartnerId?: string | null;
  grantPartners?: { id: string; name: string }[];
  grantLeadId?: string | null;
  grantLeads?: { id: string; name: string | null; email: string }[];
  isMultiPartner?: boolean;
  deliveryPartners?: { id: string; name: string; sortOrder: number; sharedPct: number }[];
} & PartnerDraftState;

export default function BudgetEditor({ budget, notes }: { budget: Budget; notes: DraftNote[] }) {
  // A null line is a whole-budget send-back note, read in the panel below; the
  // rest hang off the line they were raised on.
  const notesByLine: Record<string, DraftNote[]> = {};
  for (const n of notes) {
    if (n.budgetLineId) (notesByLine[n.budgetLineId] ??= []).push(n);
  }

  const domainLabels: Record<string, string> = budget.domainLabels ?? DOMAIN_LABELS;
  const bands = computeBands(budget.horizonMonths ?? budget.years * 12, budget.partialPosition ?? "end");
  const inflationRate = inflationRates(budget);
  const showAlloc = bands.length > 1;

  const [activeTab, setActiveTab] = useState<string>("master");
  const partners = budget.deliveryPartners ?? [];
  const isMultiPartner = !!budget.isMultiPartner && partners.length > 0;
  // Which delivery partner is in view: "master" = shared lines + roll-up, else a partner id.
  const [activePartner, setActivePartner] = useState<string>("master");
  const [pendingMeta, startTransition] = useTransition();

  const { lines, working, pending, error, saveLine, removeLine, appendLine, saveWorking } =
    useBudgetLines(budget.id, budget.lines, budget.workingByLineId ?? {});

  // Multi-partner: filter to the active partner first (Master = shared lines only),
  // then apply the existing domain tab filter within that slice.
  const partnerLines = !isMultiPartner
    ? lines
    : activePartner === "master"
      ? lines.filter(l => l.deliveryPartnerId == null)
      : lines.filter(l => l.deliveryPartnerId === activePartner);
  const visibleLines = activeTab === "master"
    ? partnerLines
    : partnerLines.filter(l => l.domain === activeTab || l.domain === null);

  // Roll-up across partners for the Master panel: each partner's direct Y1 total,
  // their allocated share of shared costs (by sharedPct, normalised), and total.
  const sharedTotalY1 = lines.filter(l => l.deliveryPartnerId == null).reduce((s, l) => s + l.y1Total, 0);
  const pctSum = partners.reduce((s, p) => s + (p.sharedPct || 0), 0);
  const partnerRollup = partners.map(p => {
    const direct = lines.filter(l => l.deliveryPartnerId === p.id).reduce((s, l) => s + l.y1Total, 0);
    const shareFrac = pctSum > 0 ? (p.sharedPct || 0) / pctSum : (partners.length ? 1 / partners.length : 0);
    const allocShared = Math.round(sharedTotalY1 * shareFrac);
    return { ...p, direct, allocShared, total: direct + allocShared, shareFrac };
  });
  const activePartnerRollup = partnerRollup.find(p => p.id === activePartner) ?? null;

  const grouped = SECTION_ORDER.map(sec => ({
    section: sec,
    lines: visibleLines.filter(l => l.section === sec),
  })).filter(g => g.lines.length > 0 || ["admin_salary", "admin_other", "additional"].includes(g.section));

  const grandTotal = (k: BandKey) => visibleLines.reduce((s, l) => s + l[yTotalKey(k)], 0);
  const horizonTotal = () => bands.reduce((s, b) => s + grandTotal(b.k), 0);

  // Top summary box total. For multi-partner it spans the whole budget rather
  // than just the visible (shared-only on Master) lines, which otherwise reads
  // ₹0 when there are no shared/cross-cutting items.
  const summaryYearTotal = (k: BandKey): number => {
    if (!isMultiPartner) return grandTotal(k);
    if (activePartner === "master") {
      const src = activeTab === "master" ? lines : lines.filter(l => l.domain === activeTab || l.domain === null);
      return src.reduce((s, l) => s + l[yTotalKey(k)], 0);
    }
    // Partner tab: their direct lines (domain-filtered) + allocated shared (All domains only).
    const direct = visibleLines.reduce((s, l) => s + l[yTotalKey(k)], 0);
    const sharedYear = lines.filter(l => l.deliveryPartnerId == null).reduce((s, l) => s + l[yTotalKey(k)], 0);
    const alloc = activeTab === "master" ? Math.round(sharedYear * (activePartnerRollup?.shareFrac ?? 0)) : 0;
    return direct + alloc;
  };
  const summaryHorizonTotal = () => bands.reduce((s, b) => s + summaryYearTotal(b.k), 0);

  const grandTotalLabel = activeTab === "master" ? "All domains" : (domainLabels[activeTab] ?? activeTab);
  const hasInputs = hasCountInputs(budget.inputs);

  // The grantee holds the pen while the draft is open with them; the lead's own
  // line edits would land under their submission and confuse the review diff.
  const sharedOut = budget.partnerEditState !== "closed";
  // Deletes cascade to filed report lines, so the server refuses them past draft;
  // edits and adds stay open at every status, as they always have been.
  const canDeleteLines = budget.status === "draft" && !sharedOut;

  const handleAdd = (section: BudgetSection, input: NewLineInput) =>
    appendLine(section, input, isMultiPartner && activePartner !== "master" ? activePartner : null);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-stone-900">{budget.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${budget.status === "approved" ? "bg-emerald-100 text-emerald-700" : budget.status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {budget.status === "approved" ? "Approved" : budget.status === "final" ? "Finalized" : "Draft"}
            </span>
            {budget.importedAt && (
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-700"
                title="Created by importing a filled Excel template. Its lines were entered/edited by hand, so any future regenerate-from-inputs would replace them."
              >
                Imported
              </span>
            )}
            <span className="text-xs text-stone-400">
              {horizonLabel(budget.horizonMonths ?? budget.years * 12)}
              {!budget.applyInflation && <span className="ml-1 text-stone-300">· flat</span>}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {budget.domains.map(d => <span key={d} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">{domainLabels[d] ?? d}</span>)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              Partner
              <select
                value={budget.grantPartnerId ?? ""}
                disabled={pendingMeta}
                onChange={e => {
                  const v = e.target.value || null;
                  startTransition(() => updateBudgetGrantPartner(budget.id, v));
                }}
                className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-700 disabled:opacity-60"
              >
                <option value="">Unassigned</option>
                {(budget.grantPartners ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-stone-500" title="Who is accountable for this grant — reviews the reports and gets the reminders.">
              Grant lead
              <select
                value={budget.grantLeadId ?? ""}
                disabled={pendingMeta}
                onChange={e => {
                  const v = e.target.value || null;
                  startTransition(() => updateBudgetGrantLead(budget.id, v));
                }}
                className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-700 disabled:opacity-60"
              >
                <option value="">Unassigned</option>
                {(budget.grantLeads ?? []).map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {budget.status === "approved" && (
            <a href={`/budget/${budget.id}/reports`}
              className="text-sm bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700">
              Reports
            </a>
          )}
          <a href={`/budget/${budget.id}/analysis`}
            className="text-sm border border-stone-300 px-3 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700">
            Analysis
          </a>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch(`/budget/${budget.id}/export`);
                if (!res.ok) { alert(`Export failed (${res.status})`); return; }
                const blob = await res.blob();
                const cd = res.headers.get("Content-Disposition") ?? "";
                const m = cd.match(/filename="?([^";]+)"?/);
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = m?.[1] ?? `${budget.name}_budget.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch {
                alert("Export failed. Please try again.");
              }
            }}
            className="text-sm border border-stone-300 px-3 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700">
            Export
          </button>
          {budget.status === "draft" && (
            <button
              onClick={() => startTransition(() => finalizeBudget(budget.id))}
              disabled={pendingMeta || sharedOut}
              title={sharedOut ? "Take the draft back from the grantee before finalising it." : undefined}
              className="text-sm bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-60">
              Finalize
            </button>
          )}
        </div>
      </div>

      <PartnerDraftPanel budget={budget} notesByLine={notesByLine} />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {/* Grand total bar */}
      {hasInputs && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 sm:px-5 py-4 mb-6 flex flex-wrap gap-x-6 gap-y-3 items-start">
          <div className="self-center w-full sm:w-auto text-xs font-semibold text-sky-700 uppercase tracking-wide sm:min-w-[100px]">
            {grandTotalLabel}
          </div>
          {bands.map(b => (
            <TotalCell key={b.k}
              label={`${b.label} Total`}
              value={summaryYearTotal(b.k)}
              big={b.k === 1}
            />
          ))}
          {bands.length > 1 && (
            <TotalCell label={`${horizonLabel(budget.horizonMonths ?? budget.years * 12)} Total`}
              value={summaryHorizonTotal()} big />
          )}
        </div>
      )}

      {/* Delivery-partner tabs (multi-partner budgets only) */}
      {isMultiPartner && (
        <div className="flex gap-1 mb-3 overflow-x-auto pb-1 border-b border-stone-200">
          {(["master", ...partners.map(p => p.id)]).map(pid => {
            const label = pid === "master" ? "Master" : (partners.find(p => p.id === pid)?.name ?? "Partner");
            return (
              <button key={pid} onClick={() => { setActivePartner(pid); setActiveTab("master"); }}
                className={`text-sm px-4 py-1.5 rounded-t-lg whitespace-nowrap transition-all border-b-2 ${
                  activePartner === pid ? "border-emerald-600 text-emerald-700 font-medium" : "border-transparent text-stone-500 hover:bg-stone-100"
                }`}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Master roll-up across partners */}
      {isMultiPartner && activePartner === "master" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 mb-4 overflow-x-auto">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Roll-up (Y1) — direct + allocated shared</div>
          <table className="text-sm min-w-[480px]">
            <thead><tr className="text-stone-500 text-xs">
              <th className="text-left pr-6 py-1">Partner</th><th className="text-right px-3">Direct</th>
              <th className="text-right px-3">Shared %</th><th className="text-right px-3">Allocated shared</th><th className="text-right pl-3">Total</th>
            </tr></thead>
            <tbody>
              {partnerRollup.map(p => (
                <tr key={p.id} className="border-t border-emerald-100">
                  <td className="pr-6 py-1">{p.name}</td>
                  <td className="text-right px-3">{fmt(p.direct)}</td>
                  <td className="text-right px-3 text-stone-500">{Math.round(p.shareFrac * 100)}%</td>
                  <td className="text-right px-3">{fmt(p.allocShared)}</td>
                  <td className="text-right pl-3 font-medium">{fmt(p.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-emerald-300 font-semibold">
                <td className="pr-6 py-1">All partners</td>
                <td className="text-right px-3">{fmt(partnerRollup.reduce((s, p) => s + p.direct, 0))}</td>
                <td className="text-right px-3"></td>
                <td className="text-right px-3">{fmt(sharedTotalY1)}</td>
                <td className="text-right pl-3">{fmt(partnerRollup.reduce((s, p) => s + p.total, 0))}</td>
              </tr>
            </tbody>
          </table>
          {pctSum !== 100 && partners.length > 0 && sharedTotalY1 > 0 && (
            <p className="text-xs text-amber-600 mt-2">Shared % sums to {pctSum}% (not 100) — allocations are normalised proportionally.</p>
          )}
          <p className="text-xs text-stone-400 mt-1">
            {sharedTotalY1 > 0
              ? "Lines below are the shared / cross-cutting costs (editable). Switch tabs to edit each partner's direct lines."
              : "No shared / cross-cutting costs in this budget. Switch tabs to edit each partner's direct lines."}
          </p>
        </div>
      )}

      {/* Active partner's allocated-shared note */}
      {isMultiPartner && activePartnerRollup && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 mb-4 text-sm flex flex-wrap gap-6">
          <span><span className="text-stone-500">Direct (Y1): </span><span className="font-medium">{fmt(activePartnerRollup.direct)}</span></span>
          <span><span className="text-stone-500">+ Allocated shared ({Math.round(activePartnerRollup.shareFrac * 100)}%): </span><span className="font-medium">{fmt(activePartnerRollup.allocShared)}</span></span>
          <span><span className="text-stone-500">= Partner total: </span><span className="font-semibold">{fmt(activePartnerRollup.total)}</span></span>
        </div>
      )}

      {/* Domain tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {(["master", ...budget.domains] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap transition-all ${
              activeTab === tab ? "bg-sky-600 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {tab === "master" ? (isMultiPartner ? "All domains" : "Master Summary") : (domainLabels[tab] ?? tab)}
          </button>
        ))}
      </div>

      {/* Line item tables */}
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
            canEdit={!sharedOut}
            canDelete={canDeleteLines}
            canAdd={!sharedOut}
            showHistory
            notesByLine={sharedOut ? notesByLine : undefined}
            canComment={sharedOut}
            canResolveNotes={sharedOut}
            defaultDomain={activeTab !== "master" ? activeTab : (budget.domains[0] ?? "")}
            onSaveLine={saveLine}
            onDeleteLine={removeLine}
            onAddLine={handleAdd}
            onSaveWorking={saveWorking}
          />
        ))}
      </div>

      {/* Grand total footer */}
      {hasInputs && (
        <div className="mt-6 bg-stone-900 text-white rounded-xl px-5 py-4 flex flex-wrap gap-6 items-start">
          <div className="self-center">
            <div className="text-xs text-stone-400 uppercase tracking-wide">Grand Total</div>
            <div className="text-sm font-semibold text-white">{grandTotalLabel}</div>
          </div>
          {bands.map(b => (
            <TotalCell key={b.k} label={b.label} value={grandTotal(b.k)} big={b.k === 1} white />
          ))}
          {bands.length > 1 && (
            <TotalCell label={`${horizonLabel(budget.horizonMonths ?? budget.years * 12)} Total`}
              value={horizonTotal()} big white />
          )}
        </div>
      )}
    </div>
  );
}

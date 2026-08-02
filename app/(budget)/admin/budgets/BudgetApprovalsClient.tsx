"use client";

import { useState, useTransition } from "react";
import { approveBudget } from "../../budget/report-actions";
import type { ReportFrequency } from "@/app/generated/prisma/client";
import { generateSlots } from "@/lib/budget-report-slots";

type Slot = { id: string; slotNumber: number; grantYear: number; periodFrom: string; periodTo: string; dueDate: string; status: string };
type ReportConfig = { frequency: string; grantStartDate: string; grantEndDate: string; dueAfterDays: number } | null;
type Budget = {
  id: string; name: string; city: string; years: number; status: string; domains: string[]; updatedAt: string;
  partner: { name: string | null; email: string | null };
  reportConfig: ReportConfig;
  reportSlots: Slot[];
};

const FREQ_LABELS: Record<ReportFrequency, string> = {
  monthly: "Monthly", bi_monthly: "Bi-monthly (every 2 months)", quarterly: "Quarterly",
  half_yearly: "Half-yearly", annual: "Annual",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-stone-100 text-stone-500",
  final: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function ApproveForm({ budget, onDone }: { budget: Budget; onDone: () => void }) {
  const existing = budget.reportConfig;
  const [frequency, setFrequency] = useState<ReportFrequency>((existing?.frequency as ReportFrequency) ?? "quarterly");
  const [startDate, setStartDate] = useState(existing?.grantStartDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(existing?.grantEndDate?.slice(0, 10) ?? "");
  const [dueAfter, setDueAfter] = useState(existing?.dueAfterDays ?? 30);
  const [isPending, startTransition] = useTransition();

  const previewSlots = (() => {
    if (!startDate || !endDate) return [];
    try {
      return generateSlots(new Date(startDate), new Date(endDate), frequency, dueAfter);
    } catch { return []; }
  })();

  function submit() {
    if (!startDate || !endDate) return;
    startTransition(async () => {
      await approveBudget(budget.id, {
        frequency,
        grantStartDate: new Date(startDate),
        grantEndDate: new Date(endDate),
        dueAfterDays: dueAfter,
      });
      onDone();
    });
  }

  return (
    <div className="mt-4 p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-4">
      <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Grant configuration</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs text-stone-500 block mb-1">Reporting frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value as ReportFrequency)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white">
            {(Object.keys(FREQ_LABELS) as ReportFrequency[]).map(f => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Grant start date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white" />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Grant end date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white" />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Report due (days after period)</label>
          <input type="number" value={dueAfter} min={1} max={90} onChange={e => setDueAfter(Number(e.target.value))}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white" />
        </div>
      </div>

      {previewSlots.length > 0 && (
        <div>
          <p className="text-xs text-stone-500 mb-2">{previewSlots.length} reporting slots will be generated:</p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="text-stone-400 border-b border-stone-200">
                  <th className="text-left py-1.5 pr-4 font-medium">#</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Year</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Period</th>
                  <th className="text-left py-1.5 font-medium">Due by</th>
                </tr>
              </thead>
              <tbody>
                {previewSlots.map(s => (
                  <tr key={s.slotNumber} className="border-b border-stone-100">
                    <td className="py-1.5 pr-4 text-stone-400">{s.slotNumber}</td>
                    <td className="py-1.5 pr-4 text-stone-600">Y{s.grantYear}</td>
                    <td className="py-1.5 pr-4 text-stone-800">{fmt(s.periodFrom.toISOString())} – {fmt(s.periodTo.toISOString())}</td>
                    <td className="py-1.5 text-stone-500">{fmt(s.dueDate.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={submit} disabled={isPending || !startDate || !endDate}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
          {isPending ? "Approving…" : budget.status === "approved" ? "Update config & regenerate slots" : "Approve budget"}
        </button>
        <button onClick={onDone} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
      </div>
    </div>
  );
}

export default function BudgetApprovalsClient({ budgets }: { budgets: Budget[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const pending = budgets.filter(b => b.status === "final");
  const approved = budgets.filter(b => b.status === "approved");
  const drafts = budgets.filter(b => b.status === "draft");

  const BudgetRow = ({ b }: { b: Budget }) => (
    <div className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-stone-900">{b.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[b.status]}`}>
              {b.status === "approved" ? "Approved" : b.status === "final" ? "Awaiting approval" : "Draft"}
            </span>
            <span className="text-xs text-stone-400">{b.years === 3 ? "3-year" : "1-year"} · {b.city}</span>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">{b.partner.name ?? b.partner.email}</p>
          {b.reportConfig && (
            <p className="text-xs text-stone-500 mt-1">
              {FREQ_LABELS[b.reportConfig.frequency as ReportFrequency]} · {fmt(b.reportConfig.grantStartDate)} – {fmt(b.reportConfig.grantEndDate)} · {b.reportSlots.length} slots
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(b.status === "final" || b.status === "approved") && (
            <button
              onClick={() => setExpanded(expanded === b.id ? null : b.id)}
              className={`text-sm px-4 py-1.5 rounded-lg border transition-all ${b.status === "final" ? "bg-green-600 hover:bg-green-700 text-white border-transparent" : "border-stone-200 text-stone-600 hover:border-stone-400"}`}>
              {b.status === "final" ? "Approve" : "Edit config"}
            </button>
          )}
        </div>
      </div>

      {expanded === b.id && (
        <ApproveForm budget={b} onDone={() => setExpanded(null)} />
      )}

      {b.status === "approved" && b.reportSlots.length > 0 && expanded !== b.id && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {b.reportSlots.map(s => {
            const color = s.status === "approved" ? "bg-green-100 text-green-700" : s.status === "submitted" ? "bg-sky-100 text-sky-700" : s.status === "sent_back" ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-500";
            return (
              <span key={s.id} className={`text-xs px-2 py-0.5 rounded-full ${color}`}>
                Y{s.grantYear} #{s.slotNumber}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-stone-900">Budget Approvals</h1>

      {pending.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Awaiting approval ({pending.length})</h2>
          <div className="space-y-3">{pending.map(b => <BudgetRow key={b.id} b={b} />)}</div>
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Approved ({approved.length})</h2>
          <div className="space-y-3">{approved.map(b => <BudgetRow key={b.id} b={b} />)}</div>
        </section>
      )}

      {drafts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Drafts ({drafts.length})</h2>
          <div className="space-y-3">{drafts.map(b => <BudgetRow key={b.id} b={b} />)}</div>
        </section>
      )}

      {budgets.length === 0 && (
        <p className="text-stone-400 text-sm py-12 text-center">No budgets yet.</p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import {
  saveReport, saveReportLines, saveReportFds, submitReportWithDeclaration,
  addReallocationRequest, deleteReallocationRequest,
} from "../../../../budget/report-actions";
import {
  SECTION_TO_HEAD, BUDGET_HEAD_ORDER,
  proratedBudget, cumulativeProratedBudget, varianceFlag, isDueInPeriod,
} from "@/lib/budget-report-slots";
import {
  BLANK_DECLARATION_INPUTS, declarationInputsComplete, AFFIRMATION_CLAUSES,
  type DeclarationInputs,
} from "@/lib/budget/declaration";
import type { BudgetSection, BudgetLineCadence, ReallocationDuration } from "@/app/generated/prisma/client";

type Line = {
  id: string; description: string; section: BudgetSection; domain: string | null;
  cadence: BudgetLineCadence; plannedMonths: number[];
  y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number;
};
type ReportLine = { budgetLineId: string; actualAmount: number; notes: string | null };
type ReallocationRequest = {
  id: string; status: string;
  fromLine: { id: string; description: string; section: string };
  toLine: { id: string; description: string; section: string } | null;
  toDescription: string | null; toSection: string | null;
  requestedAmount: number; durationType: string; durationMonths: number | null;
  rationale: string; sourceUnspent: number; willSustain: boolean; sustainNote: string | null;
  approvedAmount: number | null; reviewerComment: string | null;
};
type FdDetail = {
  bankName: string; fdrNumber: string; faceValue: number; maturityValue: number; cumulative: boolean;
  doi: string | null; dom: string | null; roi: number; openingBalance: number; interestAccrued: number;
  tds: number; interestReceived: number; maturedAmount: number; maturityDate: string | null; closingBalance: number;
};
type Report = {
  id: string; openingBalance: number; tranchesReceived: number; interestEarned: number;
  bankBalance: number; fdBalance: number; cashInHand: number; advances: number;
  receivables: number; payables: number; partnerNotes: string | null; reviewerNotes: string | null;
  lines: ReportLine[];
  fdDetails: FdDetail[];
  reallocationRequests: ReallocationRequest[];
  declarationAcceptedAt: string | null;
  declarationAcceptedById: string | null;
  declarationIp: string | null;
  declarationSnapshot: { affirmedBy?: { name: string | null; email: string | null } } | null;
} | null;

// Client-side FD row: all inputs are strings; dates are yyyy-mm-dd.
type FdRow = {
  bankName: string; fdrNumber: string; faceValue: string; maturityValue: string; cumulative: boolean;
  doi: string; dom: string; roi: string; openingBalance: string; interestAccrued: string; tds: string;
  interestReceived: string; maturedAmount: string; maturityDate: string; closingBalance: string;
};
const BLANK_FD: FdRow = {
  bankName: "", fdrNumber: "", faceValue: "", maturityValue: "", cumulative: true,
  doi: "", dom: "", roi: "", openingBalance: "", interestAccrued: "", tds: "",
  interestReceived: "", maturedAmount: "", maturityDate: "", closingBalance: "",
};
const fdFromDetail = (d: FdDetail): FdRow => ({
  bankName: d.bankName, fdrNumber: d.fdrNumber,
  faceValue: d.faceValue ? String(d.faceValue) : "", maturityValue: d.maturityValue ? String(d.maturityValue) : "",
  cumulative: d.cumulative,
  doi: d.doi ? d.doi.slice(0, 10) : "", dom: d.dom ? d.dom.slice(0, 10) : "",
  roi: d.roi ? String(d.roi) : "",
  openingBalance: d.openingBalance ? String(d.openingBalance) : "", interestAccrued: d.interestAccrued ? String(d.interestAccrued) : "",
  tds: d.tds ? String(d.tds) : "", interestReceived: d.interestReceived ? String(d.interestReceived) : "",
  maturedAmount: d.maturedAmount ? String(d.maturedAmount) : "",
  maturityDate: d.maturityDate ? d.maturityDate.slice(0, 10) : "", closingBalance: d.closingBalance ? String(d.closingBalance) : "",
});
type Slot = { id: string; slotNumber: number; grantYear: number; periodFrom: string; periodTo: string; dueDate: string; status: string; report: Report };
type Budget = { id: string; name: string; years: number; lines: Line[]; reportConfig: { grantStartDate: string } | null };

const SECTION_LABELS: Record<BudgetSection, string> = {
  salary: "Salary & Honorarium", capex: "Fixed Assets / CAPEX", travel: "Travel",
  programme: "Programme Expenses", admin_salary: "Admin – Salaries",
  admin_other: "Admin – Other", additional: "Additional Items",
};

const DURATION_LABELS: Record<string, string> = {
  remaining_year: "Rest of grant year",
  full_grant: "Full remaining grant period",
  custom: "Custom period",
  one_time: "One-time payment",
};

const REALLOC_STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

const FD_COLUMNS: { key: keyof FdRow; label: string; type: "text" | "num" | "date" | "cum" }[] = [
  { key: "bankName", label: "Bank name", type: "text" },
  { key: "fdrNumber", label: "FDR", type: "text" },
  { key: "faceValue", label: "Face value", type: "num" },
  { key: "maturityValue", label: "Maturity value", type: "num" },
  { key: "cumulative", label: "Cum / Non-cum", type: "cum" },
  { key: "doi", label: "DOI", type: "date" },
  { key: "dom", label: "DOM", type: "date" },
  { key: "roi", label: "ROI %", type: "num" },
  { key: "openingBalance", label: "Opening bal.", type: "num" },
  { key: "interestAccrued", label: "Int. accrued", type: "num" },
  { key: "tds", label: "TDS", type: "num" },
  { key: "interestReceived", label: "Int. received", type: "num" },
  { key: "maturedAmount", label: "Matured", type: "num" },
  { key: "maturityDate", label: "Maturity date", type: "date" },
  { key: "closingBalance", label: "Closing bal.", type: "num" },
];
// Money columns that get a subtotal row.
const FD_TOTAL_KEYS: (keyof FdRow)[] = ["faceValue", "maturityValue", "openingBalance", "interestAccrued", "tds", "interestReceived", "maturedAmount", "closingBalance"];

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function FlagChip({ flag }: { flag: "over" | "under" | null }) {
  if (!flag) return null;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${flag === "over" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
      {flag === "over" ? "Over" : "Under"}
    </span>
  );
}

const BLANK_REALLOC = {
  fromLineId: "", toLineId: "" as string | "new",
  toDescription: "", toSection: "programme" as BudgetSection,
  requestedAmount: "", durationType: "remaining_year" as ReallocationDuration,
  durationMonths: "", rationale: "",
};

export default function ReportForm({
  slot, budget, cumulativePrior, revisedAdjustments, canEdit, isSuperAdmin,
}: {
  slot: Slot; budget: Budget; cumulativePrior: Record<string, number>;
  revisedAdjustments: Record<string, number>;
  canEdit: boolean; isSuperAdmin: boolean;
}) {
  const report = slot.report;
  const existingLines: Record<string, ReportLine> = Object.fromEntries(
    (report?.lines ?? []).map(l => [l.budgetLineId, l])
  );

  const [actuals, setActuals] = useState<Record<string, string>>(
    Object.fromEntries(budget.lines.map(l => [l.id, String(existingLines[l.id]?.actualAmount ?? "")]))
  );
  const [lineNotes, setLineNotes] = useState<Record<string, string>>(
    Object.fromEntries(budget.lines.map(l => [l.id, existingLines[l.id]?.notes ?? ""]))
  );
  const [recon, setRecon] = useState({
    openingBalance: String(report?.openingBalance ?? ""),
    tranchesReceived: String(report?.tranchesReceived ?? ""),
    interestEarned: String(report?.interestEarned ?? ""),
    bankBalance: String(report?.bankBalance ?? ""),
    fdBalance: String(report?.fdBalance ?? ""),
    cashInHand: String(report?.cashInHand ?? ""),
    advances: String(report?.advances ?? ""),
    receivables: String(report?.receivables ?? ""),
    payables: String(report?.payables ?? ""),
    partnerNotes: report?.partnerNotes ?? "",
  });
  const [saving, startSave] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [saved, setSaved] = useState(false);
  const [parseStatus, setParseStatus] = useState<"idle" | "uploading" | "parsing" | "done" | "error">("idle");
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // FD details schedule
  const [fds, setFds] = useState<FdRow[]>((report?.fdDetails ?? []).map(fdFromDetail));

  // Declaration modal
  const [showDecl, setShowDecl] = useState(false);
  const [declInputs, setDeclInputs] = useState<DeclarationInputs>(BLANK_DECLARATION_INPUTS);
  const [declScanUrl, setDeclScanUrl] = useState("");
  const [declScanName, setDeclScanName] = useState("");
  const [declAffirmed, setDeclAffirmed] = useState(false);
  const [declUploading, setDeclUploading] = useState(false);
  const [declError, setDeclError] = useState<string | null>(null);
  const declScanRef = useRef<HTMLInputElement>(null);
  const [confirming, startConfirm] = useTransition();

  // Reallocation state
  const [showReallocationForm, setShowReallocationForm] = useState(false);
  const [realloc, setRealloc] = useState(BLANK_REALLOC);
  const [reallocSaving, startReallocSave] = useTransition();
  const [reallocDeleting, startReallocDelete] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const periodFrom = new Date(slot.periodFrom);
  const periodTo = new Date(slot.periodTo);
  const yearStart = budget.reportConfig
    ? (() => {
        const gs = new Date(budget.reportConfig.grantStartDate);
        return new Date(Date.UTC(gs.getUTCFullYear() + (slot.grantYear - 1), gs.getUTCMonth(), 1));
      })()
    : periodFrom;

  function yearTotal(line: Line): number {
    return slot.grantYear === 1 ? line.y1Total
      : slot.grantYear === 2 ? line.y2Total
      : slot.grantYear === 3 ? line.y3Total
      : slot.grantYear === 4 ? line.y4Total
      : line.y5Total;
  }

  function revisedYearTotal(line: Line): number {
    return yearTotal(line) + (revisedAdjustments[line.id] ?? 0);
  }

  const hasRevisions = budget.lines.some(l => (revisedAdjustments[l.id] ?? 0) !== 0);

  const nv = (v: string) => parseFloat(v) || 0;
  const reconPayload = () => ({
    openingBalance: nv(recon.openingBalance),
    tranchesReceived: nv(recon.tranchesReceived),
    interestEarned: nv(recon.interestEarned),
    bankBalance: nv(recon.bankBalance),
    cashInHand: nv(recon.cashInHand),
    advances: nv(recon.advances),
    receivables: nv(recon.receivables),
    payables: nv(recon.payables),
    partnerNotes: recon.partnerNotes || undefined,
  });
  const linesPayload = () => budget.lines.map(l => ({
    budgetLineId: l.id,
    actualAmount: nv(actuals[l.id] ?? ""),
    notes: lineNotes[l.id] || undefined,
  }));
  const fdPayload = () => fds.map(r => ({
    bankName: r.bankName, fdrNumber: r.fdrNumber,
    faceValue: nv(r.faceValue), maturityValue: nv(r.maturityValue), cumulative: r.cumulative,
    doi: r.doi || null, dom: r.dom || null, roi: nv(r.roi),
    openingBalance: nv(r.openingBalance), interestAccrued: nv(r.interestAccrued), tds: nv(r.tds),
    interestReceived: nv(r.interestReceived), maturedAmount: nv(r.maturedAmount),
    maturityDate: r.maturityDate || null, closingBalance: nv(r.closingBalance),
  }));

  // Persist everything the partner has entered. FD rows are saved after the
  // report/lines to avoid racing concurrent upserts of the same report row.
  async function persistAll() {
    await Promise.all([
      saveReport(slot.id, reconPayload()),
      saveReportLines(slot.id, linesPayload()),
    ]);
    await saveReportFds(slot.id, fdPayload());
  }

  function handleSave() {
    startSave(async () => {
      await persistAll();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  // Submit = persist everything, then open the Finance Declaration modal. The
  // modal's confirm does the actual state transition (submitReportWithDeclaration).
  function handleSubmit() {
    setSubmitError(null);
    startSubmit(async () => {
      try {
        await persistAll();
      } catch (e: any) {
        setSubmitError(e.message ?? "Save failed");
        return;
      }
      setDeclError(null);
      setShowDecl(true);
    });
  }

  async function uploadDeclScan(file: File) {
    setDeclUploading(true);
    setDeclError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/budget/declaration-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setDeclScanUrl(data.url);
      setDeclScanName(file.name);
    } catch (e: any) {
      setDeclError(e.message ?? "Upload failed");
    } finally {
      setDeclUploading(false);
      if (declScanRef.current) declScanRef.current.value = "";
    }
  }

  async function downloadDeclaration() {
    setDeclError(null);
    try {
      const res = await fetch(`/api/budget/${budget.id}/reports/${slot.id}/declaration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(declInputs),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Could not generate"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Finance-Declaration-Y${slot.grantYear}-R${slot.slotNumber}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDeclError(e.message ?? "Could not generate declaration");
    }
  }

  function handleConfirmDeclaration() {
    setDeclError(null);
    startConfirm(async () => {
      try {
        await submitReportWithDeclaration(slot.id, declInputs, declScanUrl);
      } catch (e: any) {
        setDeclError(e.message ?? "Submit failed");
      }
    });
  }

  const declReady = declarationInputsComplete(declInputs) && !!declScanUrl && declAffirmed;

  const updateFd = (i: number, key: keyof FdRow, value: string | boolean) =>
    setFds(prev => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const addFd = () => setFds(prev => [...prev, { ...BLANK_FD }]);
  const removeFd = (i: number) => setFds(prev => prev.filter((_, idx) => idx !== i));

  function handleAddRealloc() {
    if (!realloc.fromLineId || !realloc.requestedAmount || !realloc.rationale.trim()) return;
    if (realloc.toLineId === "new" && !realloc.toDescription.trim()) return;
    startReallocSave(async () => {
      const nv = (v: string) => parseFloat(v) || 0;
      await addReallocationRequest(slot.id, {
        fromLineId: realloc.fromLineId,
        toLineId: realloc.toLineId === "new" ? null : (realloc.toLineId || null),
        toDescription: realloc.toLineId === "new" ? realloc.toDescription : undefined,
        toSection: realloc.toLineId === "new" ? realloc.toSection : undefined,
        requestedAmount: nv(realloc.requestedAmount),
        durationType: realloc.durationType,
        durationMonths: realloc.durationType === "custom" ? (parseInt(realloc.durationMonths) || undefined) : undefined,
        rationale: realloc.rationale.trim(),
      });
      setRealloc(BLANK_REALLOC);
      setShowReallocationForm(false);
    });
  }

  // Group lines by section
  const bySec = budget.lines.reduce<Record<string, Line[]>>((acc, l) => {
    (acc[l.section] ??= []).push(l);
    return acc;
  }, {});

  const n = (v: string) => parseFloat(v) || 0;

  // Reconciliation check
  const totalIncome = n(recon.openingBalance) + n(recon.tranchesReceived) + n(recon.interestEarned);
  const totalActuals = budget.lines.reduce((s, l) => s + (n(actuals[l.id] ?? "") || 0), 0);
  const closingBalance = totalIncome - totalActuals;
  // FD balance is derived from the FD schedule (sum of closing balances), not typed.
  const fdBalanceDerived = fds.reduce((s, r) => s + n(r.closingBalance), 0);
  const fundBalance = n(recon.bankBalance) + fdBalanceDerived + n(recon.cashInHand) + n(recon.advances) + n(recon.receivables) - n(recon.payables);
  const reconDiff = closingBalance - fundBalance;

  const reallocRequests = report?.reallocationRequests ?? [];
  const pendingReallocCount = reallocRequests.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div>
        <Link href={`/budget/${budget.id}/reports`} className="text-xs text-stone-400 hover:text-stone-700">← Reports</Link>
        <h1 className="text-xl font-semibold text-stone-900 mt-2">
          {fmtDate(slot.periodFrom)} – {fmtDate(slot.periodTo)}
        </h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-sm text-stone-500">Grant Year {slot.grantYear} · Report #{slot.slotNumber}</span>
          {slot.status === "sent_back" && report?.reviewerNotes && (
            <span className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded-lg">
              Sent back: {report.reviewerNotes}
            </span>
          )}
        </div>
      </div>

      {/* Line-item actuals */}
      <section>
        <h2 className="text-base font-semibold text-stone-800 mb-4">Line-item actuals</h2>
        {hasRevisions && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Revised budget shown — prior approved reallocations have adjusted some line budgets.
          </p>
        )}
        <div className="space-y-6">
          {(Object.keys(SECTION_LABELS) as BudgetSection[]).map(sec => {
            const lines = bySec[sec];
            if (!lines?.length) return null;
            return (
              <div key={sec}>
                <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">{SECTION_LABELS[sec]}</h3>
                <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-stone-50 border-b border-stone-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-stone-500 text-xs">Line item</th>
                        <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">Annual budget</th>
                        {hasRevisions && <th className="text-right px-3 py-2.5 font-medium text-amber-600 text-xs">Revised budget</th>}
                        <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">Period budget</th>
                        <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">This period actual</th>
                        <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">YTD actual</th>
                        <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">YTD budget</th>
                        <th className="px-3 py-2.5 font-medium text-stone-500 text-xs">Variance</th>
                        {canEdit && <th className="px-3 py-2.5 font-medium text-stone-500 text-xs w-32">Notes</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lines.map(line => {
                        const rvt = revisedYearTotal(line);
                        const cadenceLine = { yearTotal: rvt, cadence: line.cadence, plannedMonths: line.plannedMonths };
                        const periodBudget = proratedBudget(cadenceLine, periodFrom, periodTo, yearStart);
                        const ytdBudget = cumulativeProratedBudget(cadenceLine, yearStart, periodTo);
                        const dueThisPeriod = isDueInPeriod(cadenceLine, periodFrom, periodTo, yearStart);
                        const thisActual = n(actuals[line.id] ?? "");
                        const priorActual = cumulativePrior[line.id] ?? 0;
                        const ytdActual = priorActual + thisActual;
                        // Only flag variance when the period actually has a budget against it.
                        // Non-due lines (capex outside its planned month, etc.) get a neutral
                        // "Not due" chip; the partner can still book early without an Under flag.
                        const flag = dueThisPeriod ? varianceFlag(ytdActual, ytdBudget) : null;
                        const varPct = dueThisPeriod && ytdBudget > 0
                          ? ((ytdActual - ytdBudget) / ytdBudget * 100).toFixed(1) : null;
                        const isRevised = (revisedAdjustments[line.id] ?? 0) !== 0;

                        return (
                          <tr key={line.id} className="hover:bg-stone-50">
                            <td className="px-4 py-2.5 text-stone-700">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>{line.description}</span>
                                {line.cadence !== "monthly" && line.plannedMonths.length > 0 && (
                                  <span className="text-[10px] uppercase tracking-wide text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                                    Planned: {line.plannedMonths.map(m => `M${m}`).join(", ")}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${isRevised ? "line-through text-stone-400" : "text-stone-600"}`}>
                              {fmt(yearTotal(line))}
                            </td>
                            {hasRevisions && (
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                                {isRevised
                                  ? <span className="font-semibold text-amber-700">{fmt(Math.round(rvt))}</span>
                                  : <span className="text-stone-300">—</span>
                                }
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right text-stone-500">
                              {dueThisPeriod ? fmt(Math.round(periodBudget)) : <span className="text-stone-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {canEdit
                                ? <input type="number" min={0} value={actuals[line.id] ?? ""}
                                    onChange={e => setActuals(p => ({ ...p, [line.id]: e.target.value }))}
                                    className="w-28 text-sm text-right border border-stone-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400" />
                                : <span className="text-stone-800">{fmt(thisActual)}</span>
                              }
                            </td>
                            <td className="px-3 py-2.5 text-right text-stone-800">{fmt(Math.round(ytdActual))}</td>
                            <td className="px-3 py-2.5 text-right text-stone-500">{fmt(Math.round(ytdBudget))}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {!dueThisPeriod ? (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">Not due</span>
                                ) : (
                                  <>
                                    {varPct !== null && (
                                      <span className={`text-xs ${flag ? "font-semibold" : "text-stone-400"}`}>
                                        {varPct}%
                                      </span>
                                    )}
                                    <FlagChip flag={flag} />
                                  </>
                                )}
                              </div>
                            </td>
                            {canEdit && (
                              <td className="px-3 py-2.5">
                                <input type="text" value={lineNotes[line.id] ?? ""}
                                  onChange={e => setLineNotes(p => ({ ...p, [line.id]: e.target.value }))}
                                  placeholder="Note…"
                                  className="w-full text-xs border border-stone-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400" />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Budget head summary */}
      <section>
        <h2 className="text-base font-semibold text-stone-800 mb-4">Budget head summary</h2>
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-stone-500 text-xs">Budget head</th>
                <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">Annual budget</th>
                <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">Period budget</th>
                <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">This period</th>
                <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">YTD actual</th>
                <th className="text-right px-3 py-2.5 font-medium text-stone-500 text-xs">YTD budget</th>
                <th className="px-3 py-2.5 font-medium text-stone-500 text-xs">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {BUDGET_HEAD_ORDER.map(head => {
                const headLines = budget.lines.filter(l => SECTION_TO_HEAD[l.section] === head);
                if (!headLines.length) return null;
                const annualBudget = headLines.reduce((s, l) => s + revisedYearTotal(l), 0);
                const periodBud = headLines.reduce((s, l) => s + proratedBudget(
                  { yearTotal: revisedYearTotal(l), cadence: l.cadence, plannedMonths: l.plannedMonths },
                  periodFrom, periodTo, yearStart,
                ), 0);
                const ytdBud = headLines.reduce((s, l) => s + cumulativeProratedBudget(
                  { yearTotal: revisedYearTotal(l), cadence: l.cadence, plannedMonths: l.plannedMonths },
                  yearStart, periodTo,
                ), 0);
                const thisPeriodAct = headLines.reduce((s, l) => s + n(actuals[l.id] ?? ""), 0);
                const priorAct = headLines.reduce((s, l) => s + (cumulativePrior[l.id] ?? 0), 0);
                const ytdAct = priorAct + thisPeriodAct;
                const flag = varianceFlag(ytdAct, ytdBud);
                const varPct = ytdBud > 0 ? ((ytdAct - ytdBud) / ytdBud * 100).toFixed(1) : null;
                return (
                  <tr key={head} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5 text-stone-700 font-medium">{head}</td>
                    <td className="px-3 py-2.5 text-right text-stone-500">{fmt(Math.round(annualBudget))}</td>
                    <td className="px-3 py-2.5 text-right text-stone-500">{fmt(Math.round(periodBud))}</td>
                    <td className="px-3 py-2.5 text-right text-stone-800">{fmt(Math.round(thisPeriodAct))}</td>
                    <td className="px-3 py-2.5 text-right text-stone-800 font-semibold">{fmt(Math.round(ytdAct))}</td>
                    <td className="px-3 py-2.5 text-right text-stone-500">{fmt(Math.round(ytdBud))}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {varPct !== null && (
                          <span className={`text-xs ${flag ? "font-semibold" : "text-stone-400"}`}>{varPct}%</span>
                        )}
                        <FlagChip flag={flag} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-stone-50 border-t border-stone-200">
              <tr>
                <td className="px-4 py-2.5 font-semibold text-stone-800 text-sm">Total</td>
                <td className="px-3 py-2.5 text-right font-semibold text-stone-800">
                  {fmt(Math.round(budget.lines.reduce((s, l) => s + revisedYearTotal(l), 0)))}
                </td>
                <td className="px-3 py-2.5 text-right text-stone-600">
                  {fmt(Math.round(budget.lines.reduce((s, l) => s + proratedBudget(
                    { yearTotal: revisedYearTotal(l), cadence: l.cadence, plannedMonths: l.plannedMonths },
                    periodFrom, periodTo, yearStart,
                  ), 0)))}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-stone-800">
                  {fmt(Math.round(totalActuals))}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-stone-800">
                  {fmt(Math.round(budget.lines.reduce((s, l) => s + (n(actuals[l.id] ?? "") || 0) + (cumulativePrior[l.id] ?? 0), 0)))}
                </td>
                <td className="px-3 py-2.5 text-right text-stone-500">
                  {fmt(Math.round(budget.lines.reduce((s, l) => s + cumulativeProratedBudget(
                    { yearTotal: revisedYearTotal(l), cadence: l.cadence, plannedMonths: l.plannedMonths },
                    yearStart, periodTo,
                  ), 0)))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Fund reconciliation */}
      <section>
        <h2 className="text-base font-semibold text-stone-800 mb-4">Fund reconciliation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* A – Funds */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">A – Fund movement</p>
            {([
              ["openingBalance", "Opening balance"],
              ["tranchesReceived", "Tranches received"],
              ["interestEarned", "Interest earned (from bank statement)"],
            ] as [keyof typeof recon, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <label className="text-sm text-stone-600">{label}</label>
                {canEdit
                  ? <input type="number" min={0} value={recon[key]}
                      onChange={e => setRecon(p => ({ ...p, [key]: e.target.value }))}
                      className="w-36 text-sm text-right border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400" />
                  : <span className="text-sm font-medium text-stone-800">{fmt(n(recon[key]))}</span>
                }
              </div>
            ))}
            <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-700">Total income</span>
              <span className="text-sm font-semibold text-stone-900">{fmt(Math.round(totalIncome))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-600">Less: total expenditure</span>
              <span className="text-sm text-stone-800">({fmt(Math.round(totalActuals))})</span>
            </div>
            <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-700">Closing balance [A]</span>
              <span className={`text-sm font-semibold ${closingBalance < 0 ? "text-red-600" : "text-stone-900"}`}>
                {fmt(Math.round(closingBalance))}
              </span>
            </div>
          </div>

          {/* B – Represented by */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">B – Represented by</p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-stone-600">Cash at bank (from statement)</label>
              {canEdit
                ? <input type="number" min={0} value={recon.bankBalance}
                    onChange={e => setRecon(p => ({ ...p, bankBalance: e.target.value }))}
                    className="w-36 text-sm text-right border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400" />
                : <span className="text-sm font-medium text-stone-800">{fmt(n(recon.bankBalance))}</span>
              }
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-stone-600">FD with bank <span className="text-stone-400">(from FD schedule)</span></label>
              <span className="text-sm font-medium text-stone-800">{fmt(Math.round(fdBalanceDerived))}</span>
            </div>
            {([
              ["cashInHand", "Cash in hand"],
              ["advances", "Advances to employees/vendors"],
              ["receivables", "Other receivables"],
              ["payables", "Less: payables / current liabilities"],
            ] as [keyof typeof recon, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <label className={`text-sm ${key === "payables" ? "text-red-500" : "text-stone-600"}`}>{label}</label>
                {canEdit
                  ? <input type="number" min={0} value={recon[key]}
                      onChange={e => setRecon(p => ({ ...p, [key]: e.target.value }))}
                      className="w-36 text-sm text-right border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400" />
                  : <span className="text-sm font-medium text-stone-800">{fmt(n(recon[key]))}</span>
                }
              </div>
            ))}
            <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-700">Fund balance [B]</span>
              <span className="text-sm font-semibold text-stone-900">{fmt(Math.round(fundBalance))}</span>
            </div>
            <div className={`flex items-center justify-between pt-1 ${Math.abs(reconDiff) > 1 ? "text-red-600" : "text-green-600"}`}>
              <span className="text-sm font-semibold">Difference [A – B]</span>
              <span className="text-sm font-semibold">{fmt(Math.round(reconDiff))}</span>
            </div>
            {Math.abs(reconDiff) > 1 && (
              <p className="text-xs text-red-500">Reconciliation does not balance — please check your figures.</p>
            )}
          </div>
        </div>

        {/* Bank statement upload */}
        {canEdit && (
          <div className="mt-4 bg-white border border-stone-200 rounded-xl p-5">
            <p className="text-sm font-medium text-stone-700 mb-1">Bank statement</p>
            <p className="text-xs text-stone-400 mb-3">Upload one or more bank statement PDFs — balances and interest will be extracted automatically. If you have monthly statements, select all at once; interest will be summed and the latest closing balance used.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png" multiple className="hidden"
                onChange={async e => {
                  const files = Array.from(e.target.files ?? []);
                  if (!files.length) return;
                  setParseStatus("uploading");
                  setParseNote(null);
                  setParseProgress("");
                  try {
                    type ParsedResult = { bankBalance: number; interestEarned: number; periodTo: string | null; periodFrom: string | null; bankName: string | null; notes: string | null };

                    async function parseFile(file: File): Promise<ParsedResult> {
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("slotId", slot.id);
                      const controller = new AbortController();
                      const parseTimeout = setTimeout(() => controller.abort(), 88_000);
                      let parseRes: Response;
                      try {
                        parseRes = await fetch("/api/budget/parse-bank-statement", {
                          method: "POST",
                          body: fd,
                          signal: controller.signal,
                        });
                      } finally {
                        clearTimeout(parseTimeout);
                      }
                      const data = await parseRes.json();
                      if (!parseRes.ok) throw new Error(data.error ?? "Parse failed");
                      return data as ParsedResult;
                    }

                    setParseStatus("parsing");
                    if (files.length > 1) setParseProgress(`0/${files.length}`);

                    // Process files with max 3 concurrent requests to avoid rate limits
                    let doneCount = 0;
                    const CONCURRENCY = 3;
                    const settlements: PromiseSettledResult<ParsedResult>[] = [];
                    for (let i = 0; i < files.length; i += CONCURRENCY) {
                      const batch = files.slice(i, i + CONCURRENCY);
                      const batchResults = await Promise.allSettled(
                        batch.map(f => parseFile(f).then(r => { doneCount++; setParseProgress(`${doneCount}/${files.length}`); return r; }))
                      );
                      settlements.push(...batchResults);
                    }

                    const results = settlements.flatMap(s => s.status === "fulfilled" ? [s.value] : []);
                    const failCount = settlements.filter(s => s.status === "rejected").length;

                    if (results.length === 0) {
                      const firstErr = settlements.find(s => s.status === "rejected") as PromiseRejectedResult;
                      const errMsg = firstErr?.reason?.name === "AbortError"
                        ? "Timed out — PDF may be too large. Try uploading fewer files at once."
                        : (firstErr?.reason?.message ?? "All files failed to parse");
                      throw new Error(errMsg);
                    }

                    // Combine: sum interest, use latest closing balance (by periodTo)
                    const totalInterest = results.reduce((s, r) => s + (r.interestEarned ?? 0), 0);
                    const latest = results.reduce((best, r) => {
                      if (!best) return r;
                      const bestDate = best.periodTo ? new Date(best.periodTo).getTime() : 0;
                      const rDate = r.periodTo ? new Date(r.periodTo).getTime() : 0;
                      return rDate >= bestDate ? r : best;
                    }, null as ParsedResult | null)!;

                    setRecon(p => ({
                      ...p,
                      bankBalance: latest.bankBalance != null ? String(latest.bankBalance) : p.bankBalance,
                      interestEarned: String(totalInterest),
                    }));

                    const banks = [...new Set(results.map(r => r.bankName).filter(Boolean))];
                    const notes = results.map(r => r.notes).filter(Boolean);
                    setParseNote(
                      (banks.length ? `Parsed from ${banks.join(", ")}` : "Parsed successfully") +
                      (files.length > 1 ? ` · ${results.length}/${files.length} statements combined` : "") +
                      (failCount > 0 ? ` · ${failCount} file(s) failed — review fields` : "") +
                      (notes.length ? ` · ${notes.join("; ")}` : "")
                    );
                    setParseStatus(failCount > 0 ? "error" : "done");
                  } catch (err: any) {
                    setParseNote(err.message ?? "Parse failed");
                    setParseStatus("error");
                  }
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button onClick={() => fileRef.current?.click()} disabled={parseStatus === "uploading" || parseStatus === "parsing"}
                className="text-sm border border-stone-200 hover:border-sky-400 text-stone-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                {parseStatus === "uploading"
                  ? `Uploading…${parseProgress ? ` (${parseProgress})` : ""}`
                  : parseStatus === "parsing"
                  ? `Extracting…${parseProgress ? ` (${parseProgress})` : ""}`
                  : "Upload statement(s)"}
              </button>
              {parseNote && (
                <span className={`text-xs ${parseStatus === "error" ? "text-red-500" : "text-green-600"}`}>
                  {parseStatus === "done" ? "✓ " : "✗ "}{parseNote}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-300 mt-2">Fields will be pre-filled — review and correct before saving.</p>
          </div>
        )}

        {/* Partner notes */}
        {(canEdit || recon.partnerNotes) && (
          <div className="mt-4">
            <label className="text-xs text-stone-500 block mb-1">Notes / comments</label>
            {canEdit
              ? <textarea value={recon.partnerNotes} onChange={e => setRecon(p => ({ ...p, partnerNotes: e.target.value }))}
                  rows={3} placeholder="Any notes for the reviewer…"
                  className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
              : <p className="text-sm text-stone-700">{recon.partnerNotes}</p>
            }
          </div>
        )}
      </section>

      {/* FD details schedule */}
      {(canEdit || fds.length > 0) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-y-2 mb-3">
            <div>
              <h2 className="text-base font-semibold text-stone-800">Fixed deposit details</h2>
              <p className="text-xs text-stone-400 mt-0.5">One row per FD held during the period. The FD balance in the reconciliation above is the sum of closing balances.</p>
            </div>
            {canEdit && (
              <button onClick={addFd} className="text-sm border border-stone-200 hover:border-sky-400 text-stone-700 px-3 py-1.5 rounded-lg transition-colors">+ Add FD</button>
            )}
          </div>
          {fds.length === 0
            ? <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-5">No fixed deposits recorded for this period.</p>
            : (
              <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
                <table className="text-xs whitespace-nowrap min-w-full">
                  <thead>
                    <tr className="border-b border-stone-100 text-stone-500">
                      <th className="px-2 py-2 text-left font-medium">#</th>
                      {FD_COLUMNS.map(c => <th key={c.key} className="px-2 py-2 text-left font-medium">{c.label}</th>)}
                      {canEdit && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {fds.map((row, i) => (
                      <tr key={i} className="border-b border-stone-50">
                        <td className="px-2 py-1.5 text-stone-400">{i + 1}</td>
                        {FD_COLUMNS.map(c => (
                          <td key={c.key} className="px-2 py-1.5">
                            {!canEdit
                              ? <span className="text-stone-700">
                                  {c.type === "cum" ? (row.cumulative ? "Cumulative" : "Non-cumulative")
                                    : c.type === "num" ? (row[c.key] ? Number(row[c.key]).toLocaleString("en-IN") : "—")
                                    : (row[c.key] as string) || "—"}
                                </span>
                              : c.type === "cum"
                                ? <select value={row.cumulative ? "1" : "0"} onChange={e => updateFd(i, "cumulative", e.target.value === "1")}
                                    className="border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400">
                                    <option value="1">Cumulative</option>
                                    <option value="0">Non-cumulative</option>
                                  </select>
                                : <input
                                    type={c.type === "num" ? "number" : c.type === "date" ? "date" : "text"}
                                    value={row[c.key] as string}
                                    onChange={e => updateFd(i, c.key, e.target.value)}
                                    className={`${c.type === "text" ? "w-28" : c.type === "date" ? "w-32" : "w-24 text-right"} border border-stone-200 rounded px-1.5 py-1 focus:outline-none focus:border-sky-400`} />
                            }
                          </td>
                        ))}
                        {canEdit && (
                          <td className="px-2 py-1.5">
                            <button onClick={() => removeFd(i)} className="text-stone-300 hover:text-red-500" title="Remove FD">✕</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-t border-stone-200 font-medium text-stone-700">
                      <td className="px-2 py-2" />
                      {FD_COLUMNS.map(c => (
                        <td key={c.key} className="px-2 py-2 text-right">
                          {FD_TOTAL_KEYS.includes(c.key)
                            ? fmt(Math.round(fds.reduce((s, r) => s + n(r[c.key] as string), 0)))
                            : c.key === "bankName" ? <span className="text-left block">Sub-total</span> : ""}
                        </td>
                      ))}
                      {canEdit && <td />}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {/* Reallocation requests */}
      {(canEdit || reallocRequests.length > 0) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-y-2 mb-4">
            <div>
              <h2 className="text-base font-semibold text-stone-800">Reallocation requests</h2>
              <p className="text-xs text-stone-400 mt-0.5">Request budget reallocation from one line to another</p>
            </div>
            {canEdit && !showReallocationForm && (
              <button onClick={() => setShowReallocationForm(true)}
                className="text-sm border border-sky-300 text-sky-700 hover:bg-sky-50 px-4 py-1.5 rounded-lg transition-colors">
                + Add request
              </button>
            )}
          </div>

          {/* Existing requests */}
          {reallocRequests.length > 0 && (
            <div className="space-y-3 mb-4">
              {reallocRequests.map(req => (
                <div key={req.id} className={`border rounded-xl px-5 py-4 ${REALLOC_STATUS_STYLE[req.status] ?? "border-stone-200"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-stone-800">
                          {req.fromLine.description} → {req.toLine?.description ?? req.toDescription ?? "New line"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                          req.status === "approved" ? "bg-green-100 text-green-700"
                          : req.status === "rejected" ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                        }`}>{req.status}</span>
                      </div>
                      <p className="text-xs text-stone-500">
                        {fmt(Math.round(req.requestedAmount))} · {DURATION_LABELS[req.durationType] ?? req.durationType}
                        {req.durationType === "custom" && req.durationMonths ? ` (${req.durationMonths} months)` : ""}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">{req.rationale}</p>
                      {!req.willSustain && req.sustainNote && (
                        <p className="text-xs text-amber-700 mt-1">{req.sustainNote}</p>
                      )}
                      {req.status === "approved" && req.approvedAmount != null && req.approvedAmount !== req.requestedAmount && (
                        <p className="text-xs text-green-700 mt-1">Approved amount: {fmt(Math.round(req.approvedAmount))}</p>
                      )}
                      {req.reviewerComment && (
                        <p className="text-xs text-stone-600 mt-1 italic">"{req.reviewerComment}"</p>
                      )}
                    </div>
                    {canEdit && req.status === "pending" && (
                      <button
                        disabled={reallocDeleting}
                        onClick={() => startReallocDelete(async () => { await deleteReallocationRequest(req.id); })}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {showReallocationForm && canEdit && (
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-stone-700">New reallocation request</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-stone-500 block mb-1">From line (source)</label>
                  <select value={realloc.fromLineId}
                    onChange={e => setRealloc(p => ({ ...p, fromLineId: e.target.value }))}
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400">
                    <option value="">Select line…</option>
                    {budget.lines.map(l => (
                      <option key={l.id} value={l.id}>{l.description}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-stone-500 block mb-1">To line (destination)</label>
                  <select value={realloc.toLineId}
                    onChange={e => setRealloc(p => ({ ...p, toLineId: e.target.value }))}
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400">
                    <option value="">Select line…</option>
                    <option value="new">— Create new budget line —</option>
                    {budget.lines.filter(l => l.id !== realloc.fromLineId).map(l => (
                      <option key={l.id} value={l.id}>{l.description}</option>
                    ))}
                  </select>
                </div>

                {realloc.toLineId === "new" && (
                  <>
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">New line description</label>
                      <input type="text" value={realloc.toDescription}
                        onChange={e => setRealloc(p => ({ ...p, toDescription: e.target.value }))}
                        placeholder="e.g. Field visit expenses"
                        className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Budget section</label>
                      <select value={realloc.toSection}
                        onChange={e => setRealloc(p => ({ ...p, toSection: e.target.value as BudgetSection }))}
                        className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400">
                        {(Object.keys(SECTION_LABELS) as BudgetSection[]).map(s => (
                          <option key={s} value={s}>{SECTION_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="text-xs text-stone-500 block mb-1">Amount to reallocate (₹)</label>
                  <input type="number" min={0} value={realloc.requestedAmount}
                    onChange={e => setRealloc(p => ({ ...p, requestedAmount: e.target.value }))}
                    placeholder="0"
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
                </div>

                <div>
                  <label className="text-xs text-stone-500 block mb-1">Duration</label>
                  <select value={realloc.durationType}
                    onChange={e => setRealloc(p => ({ ...p, durationType: e.target.value as ReallocationDuration }))}
                    className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400">
                    <option value="remaining_year">Rest of grant year</option>
                    <option value="full_grant">Full remaining grant period</option>
                    <option value="custom">Custom number of months</option>
                    <option value="one_time">One-time payment</option>
                  </select>
                </div>

                {realloc.durationType === "custom" && (
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Number of months</label>
                    <input type="number" min={1} value={realloc.durationMonths}
                      onChange={e => setRealloc(p => ({ ...p, durationMonths: e.target.value }))}
                      placeholder="e.g. 3"
                      className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-stone-500 block mb-1">Rationale</label>
                <textarea value={realloc.rationale}
                  onChange={e => setRealloc(p => ({ ...p, rationale: e.target.value }))}
                  rows={2} placeholder="Explain why this reallocation is needed…"
                  className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
              </div>

              <div className="flex gap-3">
                <button onClick={handleAddRealloc} disabled={reallocSaving}
                  className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                  {reallocSaving ? "Saving…" : "Add request"}
                </button>
                <button onClick={() => { setShowReallocationForm(false); setRealloc(BLANK_REALLOC); }}
                  className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
              </div>
            </div>
          )}

          {pendingReallocCount > 0 && !canEdit && (
            <p className="text-xs text-amber-700">{pendingReallocCount} pending reallocation request{pendingReallocCount > 1 ? "s" : ""} — resolve before approving report.</p>
          )}
        </section>
      )}

      {/* Finance declaration record */}
      {report?.declarationAcceptedAt && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
          <p className="font-medium">Finance Declaration affirmed</p>
          <p className="text-xs text-emerald-700 mt-1">
            {report.declarationSnapshot?.affirmedBy?.name ?? report.declarationSnapshot?.affirmedBy?.email ?? "Partner"}
            {" · "}{fmtDate(report.declarationAcceptedAt)}
            {report.declarationIp ? ` · IP ${report.declarationIp}` : ""}
          </p>
          <a href={`/api/budget/${budget.id}/reports/${slot.id}/declaration-scan`} target="_blank" rel="noreferrer"
            className="inline-block mt-2 text-xs text-emerald-700 underline hover:text-emerald-900">
            View signed &amp; sealed declaration →
          </a>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && (
          <>
            <button onClick={handleSave} disabled={saving}
              className="bg-white border border-stone-200 hover:border-stone-400 text-stone-700 text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50">
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save draft"}
            </button>
            <button onClick={handleSubmit} disabled={submitting || saving}
              className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit for review"}
            </button>
          </>
        )}
        {(isSuperAdmin || slot.status === "approved") && (
          <a href={`/api/budget/${budget.id}/reports/${slot.id}/export`}
            className="border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm font-medium px-5 py-2 rounded-lg transition-colors">
            Export (.xlsx)
          </a>
        )}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
      </div>

      {/* Finance Declaration modal */}
      {showDecl && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-xl">
            <div className="p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-900">Finance Declaration</h2>
              <p className="text-sm text-stone-500 mt-1">
                This is a legally binding declaration. The fund-utilisation figures are taken from your report.
                Fill the fields below, download the pre-filled declaration, get it signed by both heads on your
                organisation letterhead with the seal affixed, and upload the scan.
              </p>
            </div>

            <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  ["grantId", "Grant ID", "e.g. G-2024-00123"],
                  ["orgHeadName", "Head of Organization / Programme — name", ""],
                  ["orgHeadDesignation", "…designation", ""],
                  ["finHeadName", "Head of Finance — name", ""],
                  ["finHeadDesignation", "…designation", ""],
                  ["valid12A", "12A valid until (e.g. 31/03/2027)", ""],
                  ["valid80G", "80G valid until", ""],
                ] as [keyof DeclarationInputs, string, string][]).map(([key, label, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-stone-500 block mb-1">{label}</label>
                    <input type="text" value={declInputs[key] as string} placeholder={ph}
                      onChange={e => setDeclInputs(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
                  </div>
                ))}
                <div className="sm:col-span-2 flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-stone-600">
                    <input type="checkbox" checked={declInputs.fcraApplicable}
                      onChange={e => setDeclInputs(p => ({ ...p, fcraApplicable: e.target.checked }))} />
                    FCRA registered
                  </label>
                  {declInputs.fcraApplicable && (
                    <input type="text" value={declInputs.validFCRA} placeholder="FCRA valid until"
                      onChange={e => setDeclInputs(p => ({ ...p, validFCRA: e.target.value }))}
                      className="flex-1 text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
                  )}
                </div>
              </div>

              <div className="border-t border-stone-100 pt-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={downloadDeclaration} disabled={!declarationInputsComplete(declInputs)}
                    className="text-sm border border-stone-200 hover:border-sky-400 text-stone-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                    ⬇ Download declaration (.docx)
                  </button>
                  {!declarationInputsComplete(declInputs) && <span className="text-xs text-stone-400">Complete all fields to enable</span>}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <input ref={declScanRef} type="file" accept=".pdf,image/jpeg,image/png" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadDeclScan(f); }} />
                  <button onClick={() => declScanRef.current?.click()} disabled={declUploading}
                    className="text-sm border border-stone-200 hover:border-sky-400 text-stone-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                    {declUploading ? "Uploading…" : declScanUrl ? "Replace signed scan" : "Upload signed & sealed scan"}
                  </button>
                  {declScanUrl && <span className="text-xs text-green-600">✓ {declScanName || "uploaded"}</span>}
                </div>

                <label className="flex items-start gap-2 text-sm text-stone-700 pt-1">
                  <input type="checkbox" checked={declAffirmed} onChange={e => setDeclAffirmed(e.target.checked)} className="mt-1" />
                  <span>
                    We hereby declare and affirm the following:
                    <ul className="list-disc pl-5 mt-1 space-y-1 text-xs text-stone-500">
                      {AFFIRMATION_CLAUSES.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </span>
                </label>

                <p className="text-xs text-stone-400">By confirming, your name, the timestamp and your IP address are recorded against this declaration.</p>
                {declError && <p className="text-sm text-red-600">{declError}</p>}
              </div>
            </div>

            <div className="p-6 border-t border-stone-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowDecl(false)} disabled={confirming}
                className="text-sm text-stone-500 hover:text-stone-800 px-4 py-2">Cancel</button>
              <button onClick={handleConfirmDeclaration} disabled={!declReady || confirming}
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50">
                {confirming ? "Submitting…" : "Confirm & submit for review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

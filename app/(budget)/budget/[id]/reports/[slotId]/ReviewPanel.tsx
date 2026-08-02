"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { approveReport, sendBackReport, resolveReallocationRequest } from "../../../../budget/report-actions";
import ReportForm from "./ReportForm";

type Slot = { id: string; slotNumber: number; grantYear: number; periodFrom: string; periodTo: string; dueDate: string; status: string; report: any };
type Budget = { id: string; name: string; years: number; lines: any[]; reportConfig: any };

type ReallocationRequest = {
  id: string; status: string;
  fromLine: { id: string; description: string };
  toLine: { id: string; description: string } | null;
  toDescription: string | null;
  requestedAmount: number; durationType: string; durationMonths: number | null;
  targetGrantYear: number | null;
  rationale: string; sourceUnspent: number; willSustain: boolean; sustainNote: string | null;
  approvedAmount: number | null; reviewerComment: string | null;
};

function CarryForwardChip({ year }: { year: number | null }) {
  if (year == null) return null;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
      carry forward to Year {year}
    </span>
  );
}

const DURATION_LABELS: Record<string, string> = {
  remaining_year: "Rest of grant year",
  full_grant: "Full remaining grant period",
  custom: "Custom period",
  one_time: "One-time payment",
};

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function ReallocationReviewCard({
  req, disabled,
}: { req: ReallocationRequest; disabled: boolean }) {
  const [approvedAmount, setApprovedAmount] = useState(String(req.requestedAmount));
  const [comment, setComment] = useState(req.reviewerComment ?? "");
  const [showForm, setShowForm] = useState(false);
  const [resolving, startResolve] = useTransition();

  if (req.status !== "pending") {
    return (
      <div className={`border rounded-xl px-5 py-4 ${req.status === "approved" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-medium text-stone-800">
            {req.fromLine.description} → {req.toLine?.description ?? req.toDescription ?? "New line"}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${req.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {req.status}
          </span>
          <CarryForwardChip year={req.targetGrantYear} />
        </div>
        <p className="text-xs text-stone-500">{fmt(Math.round(req.requestedAmount))} · {DURATION_LABELS[req.durationType] ?? req.durationType}</p>
        {req.status === "approved" && req.approvedAmount != null && req.approvedAmount !== req.requestedAmount && (
          <p className="text-xs text-green-700 mt-1">Approved: {fmt(Math.round(req.approvedAmount))}</p>
        )}
        {req.reviewerComment && <p className="text-xs text-stone-600 mt-1 italic">"{req.reviewerComment}"</p>}
      </div>
    );
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl px-5 py-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-medium text-stone-800">
            {req.fromLine.description} → {req.toLine?.description ?? req.toDescription ?? "New line"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Pending</span>
          <CarryForwardChip year={req.targetGrantYear} />
          {!req.willSustain && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Sustain concern</span>
          )}
        </div>
        <p className="text-xs text-stone-600">
          {fmt(Math.round(req.requestedAmount))} · {DURATION_LABELS[req.durationType] ?? req.durationType}
          {req.durationType === "custom" && req.durationMonths ? ` (${req.durationMonths} months)` : ""}
        </p>
        <p className="text-xs text-stone-600 mt-0.5">{req.rationale}</p>
        <p className="text-xs text-stone-400 mt-0.5">Source unspent: {fmt(Math.round(req.sourceUnspent))}</p>
        {req.sustainNote && <p className="text-xs text-amber-700 mt-0.5">{req.sustainNote}</p>}
      </div>

      {!showForm ? (
        <div className="flex gap-2">
          <button onClick={() => setShowForm(true)} disabled={disabled}
            className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
            Review
          </button>
        </div>
      ) : (
        <div className="space-y-3 pt-1 border-t border-amber-200">
          <div className="flex items-center gap-3">
            <label className="text-xs text-stone-600 shrink-0">Approved amount (₹)</label>
            <input type="number" min={0} max={req.requestedAmount} value={approvedAmount}
              onChange={e => setApprovedAmount(e.target.value)}
              className="w-36 text-sm text-right border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400 bg-white" />
            <span className="text-xs text-stone-400">of {fmt(Math.round(req.requestedAmount))}</span>
          </div>
          <div>
            <label className="text-xs text-stone-600 block mb-1">Comment (optional)</label>
            <input type="text" value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Note for partner…"
              className="w-full text-sm border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-400 bg-white" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              disabled={resolving || disabled}
              onClick={() => startResolve(async () => {
                const amt = parseFloat(approvedAmount) || 0;
                await resolveReallocationRequest(req.id, {
                  status: "approved",
                  approvedAmount: amt,
                  reviewerComment: comment.trim() || undefined,
                });
              })}
              className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">
              {resolving ? "Saving…" : "Approve"}
            </button>
            <button
              disabled={resolving || disabled}
              onClick={() => startResolve(async () => {
                await resolveReallocationRequest(req.id, {
                  status: "rejected",
                  reviewerComment: comment.trim() || undefined,
                });
              })}
              className="text-sm border border-red-300 text-red-700 hover:bg-red-50 px-4 py-1.5 rounded-lg disabled:opacity-50">
              Reject
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReviewPanel({
  slot, budget, cumulativePrior, revisedAdjustments, canComment = false, canResolveNotes = false,
}: {
  slot: Slot; budget: Budget; cumulativePrior: Record<string, number>;
  revisedAdjustments: Record<string, number>;
  canComment?: boolean; canResolveNotes?: boolean;
}) {
  const [sendBackNotes, setSendBackNotes] = useState("");
  const [showSendBack, setShowSendBack] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approving, startApprove] = useTransition();
  const [sendingBack, startSendBack] = useTransition();

  const reallocRequests: ReallocationRequest[] = slot.report?.reallocationRequests ?? [];
  const pendingCount = reallocRequests.filter(r => r.status === "pending").length;
  const openQueries: number = (slot.report?.lineNotes ?? []).filter((n: { resolvedAt: string | null }) => !n.resolvedAt).length;

  function handleApprove() {
    setApproveError(null);
    startApprove(async () => {
      try {
        await approveReport(slot.id);
      } catch (e: any) {
        setApproveError(e.message ?? "Approval failed");
      }
    });
  }

  function handleSendBack() {
    const notes = sendBackNotes.trim();
    if (!notes && openQueries === 0) return;
    startSendBack(async () => {
      await sendBackReport(slot.id, notes || `See the ${openQueries} line quer${openQueries === 1 ? "y" : "ies"} raised on this report.`);
      setShowSendBack(false);
    });
  }

  return (
    <div className="space-y-6">
      {/* Review action bar */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-amber-800">Reviewing submission</p>
          <p className="text-xs text-amber-600 mt-0.5">Report #{slot.slotNumber} · Grant Year {slot.grantYear}</p>
        </div>
        <div className="flex items-center gap-3">
          <a href={`/api/budget/${budget.id}/reports/${slot.id}/export`}
            className="border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Export (.xlsx)
          </a>
          <button onClick={() => setShowSendBack(s => !s)}
            className="border border-amber-300 text-amber-700 hover:bg-amber-100 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Send back
          </button>
          <button onClick={handleApprove} disabled={approving || pendingCount > 0}
            title={pendingCount > 0 ? `${pendingCount} reallocation request(s) pending` : undefined}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {approving ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>

      {slot.report?.declarationAcceptedAt && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-emerald-900">Finance Declaration affirmed</p>
          <p className="text-xs text-emerald-700 mt-1">
            {slot.report.declarationSnapshot?.affirmedBy?.name ?? slot.report.declarationSnapshot?.affirmedBy?.email ?? "Partner"}
            {" · "}{new Date(slot.report.declarationAcceptedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            {slot.report.declarationIp ? ` · IP ${slot.report.declarationIp}` : ""}
          </p>
          <a href={`/api/budget/${budget.id}/reports/${slot.id}/declaration-scan`} target="_blank" rel="noreferrer"
            className="inline-block mt-2 text-xs text-emerald-700 underline hover:text-emerald-900">
            View signed &amp; sealed declaration →
          </a>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm text-amber-700 font-medium">{pendingCount} reallocation request{pendingCount > 1 ? "s" : ""} need your attention before you can approve this report.</p>
        </div>
      )}
      {approveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <p className="text-sm text-red-700">{approveError}</p>
        </div>
      )}

      {showSendBack && (
        <div className="bg-white border border-red-200 rounded-xl px-5 py-4 space-y-3">
          <p className="text-sm font-semibold text-stone-700">Send back with notes</p>
          <p className="text-xs text-stone-500">
            {openQueries > 0
              ? `${openQueries} line quer${openQueries === 1 ? "y" : "ies"} will go back with this — the partner sees them against the lines you raised them on.`
              : "Raise a query on the specific lines below to tell the partner exactly what to fix."}
          </p>
          <textarea value={sendBackNotes} onChange={e => setSendBackNotes(e.target.value)}
            rows={3} placeholder="Explain what needs to be corrected…"
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-red-400" />
          <div className="flex gap-3">
            <button onClick={handleSendBack} disabled={sendingBack || (!sendBackNotes.trim() && openQueries === 0)}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
              {sendingBack ? "Sending…" : "Confirm send back"}
            </button>
            <button onClick={() => setShowSendBack(false)} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
          </div>
        </div>
      )}

      {/* Reallocation requests panel */}
      {reallocRequests.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-stone-800 mb-3">Reallocation requests</h2>
          <div className="space-y-3">
            {reallocRequests.map(req => (
              <ReallocationReviewCard key={req.id} req={req} disabled={approving || sendingBack} />
            ))}
          </div>
        </section>
      )}

      {/* Read-only report view */}
      <ReportForm slot={slot} budget={budget} cumulativePrior={cumulativePrior} revisedAdjustments={revisedAdjustments}
        canEdit={false} isSuperAdmin={true} canComment={canComment} canResolveNotes={canResolveNotes} />
    </div>
  );
}

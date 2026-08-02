"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createBorrowing, addRepayment, deleteBorrowing } from "../borrowing-actions";

type BudgetOpt = { id: string; name: string; city: string; partner: string | null };
type Repayment = { id: string; amount: number; repaidOn: string; note: string | null };
type Borrowing = {
  id: string; amount: number; borrowedOn: string; reason: string | null; status: string;
  fromBudget: { id: string; name: string };
  toBudget: { id: string; name: string };
  repayments: Repayment[];
};

const money = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString("en-IN")}`);
const today = () => new Date().toISOString().slice(0, 10);

export default function BorrowingsClient({ budgets, borrowings }: { budgets: BudgetOpt[]; borrowings: Borrowing[] }) {
  const [pending, start] = useTransition();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(today());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [repayFor, setRepayFor] = useState<string | null>(null);

  const opt = (b: BudgetOpt) => `${b.name}${b.partner ? ` · ${b.partner}` : ""} (${b.city})`;

  const submit = () => {
    setErr(null);
    start(async () => {
      try {
        await createBorrowing({ fromBudgetId: from, toBudgetId: to, amount: Number(amount), borrowedOn: on, reason });
        setFrom(""); setTo(""); setAmount(""); setReason(""); setOn(today());
      } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/budget/dashboard" className="text-xs text-stone-400 hover:text-stone-600">← Dashboard</Link>
        <h1 className="text-xl font-semibold text-stone-900">Cross-grant borrowing</h1>
        <p className="text-sm text-stone-500">Record when one grant's cash funded another grant's work, and log reimbursements over time.</p>
      </div>

      {/* New borrowing */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-stone-700">Record a borrowing</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-stone-500">From grant (money came from)
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm">
              <option value="">Select…</option>
              {budgets.map((b) => <option key={b.id} value={b.id}>{opt(b)}</option>)}
            </select>
          </label>
          <label className="text-xs text-stone-500">To grant (work belonged to)
            <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm">
              <option value="">Select…</option>
              {budgets.map((b) => <option key={b.id} value={b.id}>{opt(b)}</option>)}
            </select>
          </label>
          <label className="text-xs text-stone-500">Amount (₹)
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-stone-500">Date
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-stone-500 sm:col-span-2">Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. disbursement delay on Grant B" className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <button onClick={submit} disabled={pending || !from || !to || !amount} className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">
          {pending ? "Saving…" : "Record borrowing"}
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {borrowings.map((b) => {
          const repaid = b.repayments.reduce((s, r) => s + r.amount, 0);
          const outstanding = Math.max(0, b.amount - repaid);
          return (
            <div key={b.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-900">{b.fromBudget.name} <span className="text-stone-400">→</span> {b.toBudget.name}</div>
                  <div className="text-xs text-stone-500">{money(b.amount)} on {new Date(b.borrowedOn).toLocaleDateString("en-IN")}{b.reason ? ` · ${b.reason}` : ""}</div>
                </div>
                <div className="sm:text-right">
                  <div className="text-sm font-semibold text-stone-900">{money(outstanding)} <span className="text-xs font-normal text-stone-400">outstanding</span></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "reimbursed" ? "bg-emerald-100 text-emerald-700" : b.status === "partially_reimbursed" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                    {b.status === "partially_reimbursed" ? "partial" : b.status}
                  </span>
                </div>
              </div>
              {b.repayments.length > 0 && (
                <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">
                  {b.repayments.map((r) => (
                    <div key={r.id}>Repaid {money(r.amount)} on {new Date(r.repaidOn).toLocaleDateString("en-IN")}{r.note ? ` · ${r.note}` : ""}</div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {repayFor === b.id
                  ? <RepayForm borrowingId={b.id} onDone={() => setRepayFor(null)} />
                  : outstanding > 0 && <button onClick={() => setRepayFor(b.id)} className="text-xs text-sky-600 hover:underline">+ Add repayment</button>}
                <button onClick={() => start(async () => { await deleteBorrowing(b.id); })} className="text-xs text-stone-400 hover:text-red-600">Delete</button>
              </div>
            </div>
          );
        })}
        {borrowings.length === 0 && <div className="text-center py-12 text-sm text-stone-400">No borrowings recorded yet.</div>}
      </div>
    </div>
  );
}

function RepayForm({ borrowingId, onDone }: { borrowingId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(today());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded border border-stone-300 px-2 py-1 text-xs" />
      <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="rounded border border-stone-300 px-2 py-1 text-xs" />
      <button disabled={pending || !amount} onClick={() => start(async () => { await addRepayment({ borrowingId, amount: Number(amount), repaidOn: on }); onDone(); })}
        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">{pending ? "…" : "Save"}</button>
      <button onClick={onDone} className="text-xs text-stone-400">Cancel</button>
    </div>
  );
}

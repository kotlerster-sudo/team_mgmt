"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  rollup, byPartner, byGrantLead, rollupByDomain, borrowingPositions, borrowingStatus, pct,
  type GrantRow,
} from "@/lib/budget/grantAggregation";

type Borrowing = {
  id: string;
  amount: number;
  borrowedOn: string;
  reason: string | null;
  status: string;
  fromBudget: { id: string; name: string; city: string; grantPartner: { name: string } | null };
  toBudget: { id: string; name: string; city: string; grantPartner: { name: string } | null };
  repayments: { amount: number; repaidOn: string }[];
};


const money = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);
const pctStr = (u: number, a: number) => { const p = pct(u, a); return p === null ? "—" : `${p}%`; };
const period = (from: string | null, to: string | null) => {
  if (!from || !to) return "—";
  const f = new Date(from), t = new Date(to);
  const m = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return `${m(f)} – ${m(t)}`;
};

function UtilBar({ u, a }: { u: number; a: number }) {
  const p = a > 0 ? Math.min(100, (u / a) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-stone-100">
      <div className={`h-1.5 rounded-full ${p > 90 ? "bg-red-400" : p > 70 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export default function DashboardView({
  grants, domainLabels, borrowings, units, currentUserId,
}: {
  grants: GrantRow[];
  domainLabels: Record<string, string>;
  borrowings: Borrowing[];
  units: { id: string; name: string }[];
  currentUserId: string;
}) {
  const tabs = ["All", ...units.map((u) => u.name)];
  const [city, setCity] = useState<string>("All");
  const [mineOnly, setMineOnly] = useState(false);
  const [openPartner, setOpenPartner] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));

  const myGrantCount = useMemo(() => grants.filter((g) => g.grantLeadId === currentUserId).length, [grants, currentUserId]);
  const rows = useMemo(() => {
    let r = city === "All" ? grants : grants.filter((g) => g.city === city);
    if (mineOnly) r = r.filter((g) => g.grantLeadId === currentUserId);
    return r;
  }, [grants, city, mineOnly, currentUserId]);
  const partners = useMemo(() => rollup(rows, byPartner), [rows]);
  const leads = useMemo(() => rollup(rows, byGrantLead), [rows]);
  const domains = useMemo(() => rollupByDomain(rows), [rows]);
  const totApproved = rows.reduce((s, g) => s + g.approved, 0);
  const totUtilised = rows.reduce((s, g) => s + g.utilised, 0);

  const cityBorrowings = useMemo(
    () => (city === "All" ? borrowings : borrowings.filter((b) => b.fromBudget.city === city || b.toBudget.city === city)),
    [borrowings, city],
  );
  const positions = useMemo(() => {
    const agg = cityBorrowings.map((b) => ({ id: b.id, fromBudgetId: b.fromBudget.id, toBudgetId: b.toBudget.id, amount: b.amount, borrowedOn: b.borrowedOn, repayments: b.repayments }));
    const pos = borrowingPositions(agg, new Date(asOf + "T23:59:59"));
    return new Map(pos.map((p) => [p.borrowingId, p]));
  }, [cityBorrowings, asOf]);
  const totOutstanding = [...positions.values()].reduce((s, p) => s + p.outstanding, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <Link href="/budget" className="text-xs text-stone-400 hover:text-stone-600">← Budgets</Link>
          <h1 className="text-xl font-semibold text-stone-900">Grant dashboard</h1>
        </div>
        <Link href="/budget/borrowings" className="text-sm text-sky-600 hover:underline">Manage borrowings →</Link>
      </div>

      {/* Granting unit tabs */}
      <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
        {tabs.map((c) => (
          <button key={c} onClick={() => setCity(c)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${city === c ? "border-sky-600 text-sky-700" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {c}
          </button>
        ))}
        <button onClick={() => setMineOnly((v) => !v)} disabled={myGrantCount === 0}
          title={myGrantCount === 0 ? "No grants list you as grant lead yet." : undefined}
          className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${mineOnly ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"} disabled:opacity-40 disabled:hover:bg-transparent`}>
          My portfolio ({myGrantCount})
        </button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">Approved</div>
          <div className="text-2xl font-bold text-stone-900">{money(totApproved)}</div>
          <div className="text-xs text-stone-400">{rows.length} grant{rows.length === 1 ? "" : "s"} · {partners.length} partner{partners.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">Utilised</div>
          <div className="text-2xl font-bold text-stone-900">{money(totUtilised)}</div>
          <div className="mt-2"><UtilBar u={totUtilised} a={totApproved} /></div>
          <div className="text-xs text-stone-400 mt-1">{pctStr(totUtilised, totApproved)} of approved</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">Outstanding inter-grant borrowing</div>
          <div className="text-2xl font-bold text-stone-900">{money(totOutstanding)}</div>
          <div className="text-xs text-stone-400">as of {asOf}</div>
        </div>
      </div>

      {/* Partner-wise */}
      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">By partner</h2>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Partner</th>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Grants</th>
                <th className="px-4 py-2 text-right font-medium">Approved</th>
                <th className="px-4 py-2 text-right font-medium">Utilised</th>
                <th className="px-4 py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {partners.map((p) => (
                <Fragment key={p.key}>
                  <tr className="cursor-pointer hover:bg-stone-50" onClick={() => setOpenPartner(openPartner === p.key ? null : p.key)}>
                    <td className="px-4 py-2 font-medium text-stone-900">
                      <span className="inline-block w-3 text-stone-400">{openPartner === p.key ? "▾" : "▸"}</span> {p.label}
                    </td>
                    <td className="px-4 py-2 text-stone-500">{period(p.periodFrom, p.periodTo)}</td>
                    <td className="px-4 py-2 text-right text-stone-600">{p.grantCount}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(p.approved)}</td>
                    <td className="px-4 py-2 text-right">{money(p.utilised)}</td>
                    <td className="px-4 py-2 text-right">{pctStr(p.utilised, p.approved)}</td>
                  </tr>
                  {openPartner === p.key && p.grants.map((g) => (
                    <tr key={g.budgetId} className="bg-stone-50/60 text-xs">
                      <td className="px-4 py-1.5 pl-10">
                        <Link href={`/budget/${g.budgetId}`} className="text-sky-700 hover:underline">{g.name}</Link>
                        <span className="ml-2 text-stone-400">{g.domains.map((d) => domainLabels[d] ?? d).join(", ")}</span>
                      </td>
                      <td className="px-4 py-1.5 text-stone-500">{period(g.periodFrom, g.periodTo)}</td>
                      <td className="px-4 py-1.5"></td>
                      <td className="px-4 py-1.5 text-right">{money(g.approved)}</td>
                      <td className="px-4 py-1.5 text-right">{money(g.utilised)}</td>
                      <td className="px-4 py-1.5 text-right">{pctStr(g.utilised, g.approved)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {partners.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No approved grants{city === "All" ? "" : ` in ${city}`}.</td></tr>}
            </tbody>
            {partners.length > 0 && (
              <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={3}>Total</td>
                  <td className="px-4 py-2 text-right">{money(totApproved)}</td>
                  <td className="px-4 py-2 text-right">{money(totUtilised)}</td>
                  <td className="px-4 py-2 text-right">{pctStr(totUtilised, totApproved)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Grant-lead-wise */}
      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">By grant lead</h2>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Grant lead</th>
                <th className="px-4 py-2 text-right font-medium">Grants</th>
                <th className="px-4 py-2 text-right font-medium">Approved</th>
                <th className="px-4 py-2 text-right font-medium">Utilised</th>
                <th className="px-4 py-2 text-left font-medium w-40">Utilisation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {leads.map((l) => (
                <tr key={l.key}>
                  <td className={`px-4 py-2 font-medium ${l.key === "unassigned" ? "text-stone-400" : "text-stone-900"}`}>{l.label}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{l.grantCount}</td>
                  <td className="px-4 py-2 text-right font-semibold">{money(l.approved)}</td>
                  <td className="px-4 py-2 text-right">{money(l.utilised)}</td>
                  <td className="px-4 py-2"><UtilBar u={l.utilised} a={l.approved} /><div className="text-[10px] text-stone-400 mt-0.5">{pctStr(l.utilised, l.approved)}</div></td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-400">—</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Domain-wise */}
      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">By domain</h2>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Domain</th>
                <th className="px-4 py-2 text-right font-medium">Partners</th>
                <th className="px-4 py-2 text-right font-medium">Approved</th>
                <th className="px-4 py-2 text-right font-medium">Utilised</th>
                <th className="px-4 py-2 text-left font-medium w-40">Utilisation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {domains.map((d) => (
                <tr key={d.domain}>
                  <td className="px-4 py-2 font-medium text-stone-900">{domainLabels[d.domain] ?? d.domain}</td>
                  <td className="px-4 py-2 text-right text-stone-600">{d.partners.size}</td>
                  <td className="px-4 py-2 text-right font-semibold">{money(d.approved)}</td>
                  <td className="px-4 py-2 text-right">{money(d.utilised)}</td>
                  <td className="px-4 py-2"><UtilBar u={d.utilised} a={d.approved} /><div className="text-[10px] text-stone-400 mt-0.5">{pctStr(d.utilised, d.approved)}</div></td>
                </tr>
              ))}
              {domains.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-400">—</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Borrowings */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-y-2 mb-2">
          <h2 className="text-sm font-semibold text-stone-700">Cross-grant borrowing</h2>
          <label className="text-xs text-stone-500">as of <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="ml-1 rounded border border-stone-300 px-2 py-1 text-xs" /></label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">From grant (lender)</th>
                <th className="px-4 py-2 text-left font-medium">To grant (borrower)</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Repaid</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {cityBorrowings.map((b) => {
                const pos = positions.get(b.id);
                if (!pos) return null; // not yet borrowed as of date
                const st = borrowingStatus(b.amount, pos.repaid);
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-2"><span className="text-stone-900">{b.fromBudget.name}</span> <span className="text-xs text-stone-400">{b.fromBudget.grantPartner?.name ?? ""}</span></td>
                    <td className="px-4 py-2"><span className="text-stone-900">{b.toBudget.name}</span> <span className="text-xs text-stone-400">{b.toBudget.grantPartner?.name ?? ""}</span></td>
                    <td className="px-4 py-2 text-right">{money(pos.borrowed)}</td>
                    <td className="px-4 py-2 text-right text-stone-500">{money(pos.repaid)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(pos.outstanding)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st === "reimbursed" ? "bg-emerald-100 text-emerald-700" : st === "partially_reimbursed" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                        {st === "partially_reimbursed" ? "partial" : st}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {cityBorrowings.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No borrowings recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

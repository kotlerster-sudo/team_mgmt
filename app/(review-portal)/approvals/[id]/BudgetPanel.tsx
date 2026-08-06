'use client';

/**
 * Step 5 — Budget annexure.
 * Empty state: budget picker.
 * Linked state: deviation snapshot (existing HTML table), cost-per-beneficiary,
 * multi-year cash flow, outlier acks, comparables placeholder, confirm bar.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';

type BudgetOption = { id: string; name: string; city: string; domains: string[] };

type Snapshot = {
  budget_id: string;
  deviation_snapshot: {
    budgetName: string;
    city: string;
    domain: string;
    unitLabel: string;
    unitCount: number;
    groups: Array<{
      label: string;
      subtotalProposed: number;
      subtotalStandard: number;
      subtotalDelta: number;
      subtotalPct: number | null;
      rows: Array<{
        templateKey: string;
        description: string;
        perUnitProposed: number;
        perUnitStandard: number;
        perUnitDelta: number;
        pct: number | null;
      }>;
    }>;
    tableHtml: string;
  };
  cost_per_beneficiary: {
    y1_total: number;
    beneficiaries_per_year: number;
    cost_per_beneficiary: number;
    method: string;
    caveat?: string;
  };
  multi_year_cash_flow: { years: Array<{ year_label: string; amount: number }> };
  portfolio_comparables: unknown[];
  per_partner_snapshots: Record<string, unknown> | null;
  outlier_ack: Record<string, { decision: 'keeping' | 'adjust_budget'; note?: string }>;
  confirmed_at: string | null;
};

type Resp = {
  assembly: { budget_id: string | null };
  snapshot: Snapshot | null;
  locked: boolean;
};

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n))}`;

const OUTLIER_THRESHOLD_PCT = 25;

export default function BudgetPanel({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  const [state, setState] = useState<Resp | null>(null);
  const [budgets, setBudgets] = useState<BudgetOption[]>([]);
  const [picked, setPicked] = useState('');
  const [linking, setLinking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch(`/api/approvals/${assemblyId}/budget`),
      fetch('/api/budgets'),
    ]);
    if (r1.ok) setState(await r1.json());
    if (r2.ok) {
      const d = await r2.json();
      setBudgets(Array.isArray(d) ? d : d.budgets || []);
    }
  }, [assemblyId]);

  useEffect(() => {
    load();
  }, [load]);

  const link = async () => {
    if (!picked) return;
    setError(null);
    setLinking(true);
    const r = await fetch(`/api/approvals/${assemblyId}/budget/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ budget_id: picked }),
    });
    setLinking(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Link failed (${r.status})`);
      return;
    }
    await load();
  };

  const ackOutlier = async (
    templateKey: string,
    decision: 'keeping' | 'adjust_budget',
    note?: string,
  ) => {
    await fetch(`/api/approvals/${assemblyId}/budget/outlier-ack`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_key: templateKey, decision, note }),
    });
    await load();
  };

  const confirm = async () => {
    setError(null);
    setConfirming(true);
    const r = await fetch(`/api/approvals/${assemblyId}/budget/confirm`, { method: 'POST' });
    setConfirming(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Confirm failed (${r.status})`);
      return;
    }
    router.refresh();
  };

  if (!state) return <div className="text-xs text-stone-400">Loading…</div>;

  if (!state.snapshot) {
    return (
      <div>
        <p className="text-sm text-stone-600 mb-3">
          Pick the budget this approval is filing. Selecting one runs the deviation snapshot
          against the same cost registry the /budget tool uses, and computes cost-per-beneficiary
          from Step 1's target.
        </p>
        <div className={CARD}>
          <div className="flex gap-2">
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="border border-stone-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-sky-400 bg-white"
            >
              <option value="">— pick a budget —</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.city ? `, ${b.city}` : ''}
                  {b.domains?.length ? ` · ${b.domains.join(', ')}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={link}
              disabled={!picked || linking}
              className="bg-sky-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-700 disabled:bg-stone-300"
            >
              {linking ? 'Linking…' : 'Link budget'}
            </button>
          </div>
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        </div>
      </div>
    );
  }

  const snap = state.snapshot;
  const outliers: Array<{ templateKey: string; description: string; perUnitProposed: number; perUnitStandard: number; pct: number }> = [];
  for (const g of snap.deviation_snapshot.groups) {
    for (const r of g.rows) {
      if (r.pct != null && Math.abs(r.pct) >= OUTLIER_THRESHOLD_PCT) {
        outliers.push({
          templateKey: r.templateKey,
          description: r.description,
          perUnitProposed: r.perUnitProposed,
          perUnitStandard: r.perUnitStandard,
          pct: r.pct,
        });
      }
    }
  }
  outliers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const unackedCount = outliers.filter((o) => !snap.outlier_ack[o.templateKey]).length;

  return (
    <div>
      <div className={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-semibold text-stone-800">
              {snap.deviation_snapshot.budgetName}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              {snap.deviation_snapshot.city} · {snap.deviation_snapshot.domain} ·{' '}
              {snap.deviation_snapshot.unitCount} {snap.deviation_snapshot.unitLabel}
              {snap.per_partner_snapshots ? ' · multi-partner' : ''}
            </div>
          </div>
          {!state.locked && (
            <button
              type="button"
              onClick={() => {
                setState({ ...state, snapshot: null });
                setPicked('');
              }}
              className="text-xs text-stone-500 hover:text-stone-800"
            >
              Change budget
            </button>
          )}
        </div>
      </div>

      {/* Cost-per-beneficiary */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">Cost per beneficiary</div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-stone-500">Y1 total</div>
            <div className="text-stone-800 font-medium">{money(snap.cost_per_beneficiary.y1_total)}</div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Beneficiaries / year</div>
            <div className="text-stone-800 font-medium">
              {new Intl.NumberFormat('en-IN').format(snap.cost_per_beneficiary.beneficiaries_per_year)}
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-500">Cost / beneficiary</div>
            <div className="text-stone-800 font-medium">
              {money(snap.cost_per_beneficiary.cost_per_beneficiary)}
            </div>
          </div>
        </div>
        {snap.cost_per_beneficiary.caveat && (
          <div className="text-xs text-amber-700 mt-2">{snap.cost_per_beneficiary.caveat}</div>
        )}
      </div>

      {/* Multi-year cash flow */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">Multi-year cash flow</div>
        <div className="flex gap-6">
          {snap.multi_year_cash_flow.years.map((y) => (
            <div key={y.year_label}>
              <div className="text-xs text-stone-500">{y.year_label}</div>
              <div className="text-stone-800 font-medium tabular-nums">{money(y.amount)}</div>
            </div>
          ))}
          <div className="ml-auto">
            <div className="text-xs text-stone-500">Total</div>
            <div className="text-stone-800 font-medium tabular-nums">
              {money(snap.multi_year_cash_flow.years.reduce((a, y) => a + y.amount, 0))}
            </div>
          </div>
        </div>
      </div>

      {/* Deviation table (rendered from the existing HTML) */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">
          Deviation vs standard cost registry
        </div>
        <div
          className="overflow-x-auto text-xs approval-devtable"
          dangerouslySetInnerHTML={{ __html: snap.deviation_snapshot.tableHtml }}
        />
      </div>

      {/* Outlier acks */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">
          Outliers <span className="text-stone-400 font-normal">· |dev| ≥ {OUTLIER_THRESHOLD_PCT}%</span>
        </div>
        {outliers.length === 0 ? (
          <div className="text-xs text-stone-400">No outlier lines.</div>
        ) : (
          <div className="space-y-2">
            {outliers.map((o) => {
              const ack = snap.outlier_ack[o.templateKey];
              return (
                <div
                  key={o.templateKey}
                  className={`border rounded-lg p-3 ${
                    ack
                      ? ack.decision === 'keeping'
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-red-200 bg-red-50/40'
                      : 'border-amber-200 bg-amber-50/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        o.pct > 0 ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'
                      }`}
                    >
                      {o.pct > 0 ? '+' : ''}
                      {Math.round(o.pct)}%
                    </span>
                    <div className="text-sm text-stone-800 font-medium">{o.description}</div>
                    <div className="text-xs text-stone-500 ml-auto tabular-nums">
                      {money(o.perUnitProposed)} vs {money(o.perUnitStandard)}
                    </div>
                  </div>
                  {ack ? (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span
                        className={
                          ack.decision === 'keeping'
                            ? 'text-emerald-700 font-medium'
                            : 'text-red-700 font-medium'
                        }
                      >
                        {ack.decision === 'keeping' ? 'Keeping as-is' : 'Adjust budget first'}
                      </span>
                      {ack.note && <span className="italic text-stone-600">— {ack.note}</span>}
                      {!state.locked && (
                        <button
                          type="button"
                          onClick={() => ackOutlier(o.templateKey, ack.decision, undefined)}
                          className="ml-auto text-stone-400 hover:text-stone-800"
                        >
                          clear
                        </button>
                      )}
                    </div>
                  ) : (
                    !state.locked && (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => ackOutlier(o.templateKey, 'keeping')}
                          className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700"
                        >
                          Keeping
                        </button>
                        <button
                          type="button"
                          onClick={() => ackOutlier(o.templateKey, 'adjust_budget')}
                          className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700"
                        >
                          Adjust budget first
                        </button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Portfolio comparables placeholder */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">Portfolio comparables</div>
        <div className="text-xs text-stone-500">
          Empty for now. Enable by adding <code>theme</code>, <code>interventionModel</code>,{' '}
          <code>beneficiariesPerYear</code>, <code>approvedAt</code>, <code>approvedAmount</code>{' '}
          fields to the Budget schema and back-filling recent budgets.
        </div>
      </div>

      {/* Confirm */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500">
          {state.locked ? (
            <span className="text-emerald-700 font-medium">
              Budget annexure confirmed
              {snap.confirmed_at &&
                ` on ${new Date(snap.confirmed_at).toLocaleString('en-IN', {
                  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                })}`}
              .
            </span>
          ) : unackedCount > 0 ? (
            `${unackedCount} outlier(s) still need a decision.`
          ) : (
            'All outliers acknowledged. Ready to confirm.'
          )}
        </div>
        {!state.locked && (
          <button
            type="button"
            onClick={confirm}
            disabled={confirming || unackedCount > 0}
            className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
          >
            {confirming ? 'Confirming…' : 'Confirm Budget Annexure →'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}

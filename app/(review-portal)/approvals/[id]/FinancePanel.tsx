'use client';

/**
 * Step 4 — Finance annexure.
 * Left column: derived (read-only): donor diversity, statutory summary,
 * average annual spend, action points.
 * Right column: RP inputs (accounting rating + grant summary).
 * Confirm freezes derived into DB + advances to Budget.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';
const LABEL = 'text-xs font-medium text-stone-600';
const INPUT =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full';

type FinanceResponse = {
  input: {
    accounting_rating: { system?: string; monthly_close?: boolean; audit_report_url?: string | null } | null;
    grant_summary: { grant_number?: number; value_inr?: number; duration_months?: number } | null;
  };
  derived: {
    donor_diversity: Array<{
      funder_name: string;
      funder_type: string;
      origin: 'domestic' | 'international';
      amount_current: number;
      amount_prior_2y: number;
    }>;
    statutory: {
      fcra_valid_until: string | null;
      reg_12a_present: boolean;
      reg_80g_present: boolean;
      latest_itr_fy: string | null;
      latest_itr_filing_date: string | null;
    };
    accounting: {
      system: 'manual' | 'tally' | 'erp';
      monthly_close: boolean;
      audit_report_url: string | null;
      score: 'nascent' | 'basic' | 'adequate';
    };
    spend: {
      by_fy_overall: Record<string, number>;
      by_fy_foundation_share: Record<string, number>;
      average_last_3fy: number;
    };
    grant_summary: {
      grant_number: number;
      value_inr: number;
      duration_months: number;
      dependency_pct: number;
      budget_split_pct: Record<string, number>;
    };
    action_points: Array<{ source: string; title: string; detail: string }>;
    computed_dependency_pct: number;
    computed_avg_last_3fy: number;
  };
  locked: boolean;
  confirmed_at: string | null;
};

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n))}`;

const SCORE_COLORS: Record<string, string> = {
  nascent: 'bg-red-100 text-red-700',
  basic: 'bg-amber-100 text-amber-700',
  adequate: 'bg-emerald-100 text-emerald-700',
};

export default function FinancePanel({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local input state
  const [system, setSystem] = useState<'manual' | 'tally' | 'erp'>('manual');
  const [monthlyClose, setMonthlyClose] = useState(false);
  const [auditUrl, setAuditUrl] = useState('');
  const [grantNumber, setGrantNumber] = useState(1);
  const [valueInr, setValueInr] = useState(0);
  const [durationMonths, setDurationMonths] = useState(12);

  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/approvals/${assemblyId}/finance`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Load failed (${r.status})`);
      return;
    }
    const d = (await r.json()) as FinanceResponse;
    setData(d);
    const acc = d.input.accounting_rating;
    if (acc) {
      if (acc.system) setSystem(acc.system as 'manual' | 'tally' | 'erp');
      if (acc.monthly_close !== undefined) setMonthlyClose(acc.monthly_close);
      if (acc.audit_report_url) setAuditUrl(acc.audit_report_url);
    }
    const gs = d.input.grant_summary;
    if (gs) {
      if (gs.grant_number) setGrantNumber(gs.grant_number);
      if (gs.value_inr) setValueInr(gs.value_inr);
      if (gs.duration_months) setDurationMonths(gs.duration_months);
    }
  }, [assemblyId]);

  useEffect(() => {
    load();
  }, [load]);

  const flush = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    const r = await fetch(`/api/approvals/${assemblyId}/finance`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounting_rating: {
          system,
          monthly_close: monthlyClose,
          audit_report_url: auditUrl.trim() || null,
        },
        grant_summary: {
          grant_number: grantNumber,
          value_inr: valueInr,
          duration_months: durationMonths,
        },
      }),
    });
    setSaving(false);
    if (r.ok) {
      const d = await r.json();
      setSavedAt(d.saved_at);
      await load(); // re-derive so score + dependency % update
    }
  }, [assemblyId, system, monthlyClose, auditUrl, grantNumber, valueInr, durationMonths, load]);

  const schedule = useCallback(() => {
    if (data?.locked) return;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 1500);
  }, [flush, data?.locked]);

  const confirm = async () => {
    setError(null);
    await flush();
    setConfirming(true);
    const r = await fetch(`/api/approvals/${assemblyId}/finance/confirm`, { method: 'POST' });
    setConfirming(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Confirm failed (${r.status})`);
      return;
    }
    router.refresh();
  };

  if (!data) return <div className="text-xs text-stone-400">Loading…</div>;
  const { derived, locked } = data;
  const spendFys = Object.keys(derived.spend.by_fy_overall).sort();

  return (
    <div>
      <p className="text-sm text-stone-600 mb-3">
        Almost everything below is derived deterministically from partner data + DD. Fill accounting
        rating + grant summary on the right; confirm freezes the annexure and advances to Budget.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* LEFT — derived */}
        <div>
          {/* Donor diversity */}
          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-2">Donor diversity</div>
            {derived.donor_diversity.length === 0 ? (
              <div className="text-xs text-stone-400">No funders reported.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-stone-500">
                    <th className="text-left py-1 pr-2">Funder</th>
                    <th className="text-left py-1 pr-2">Type</th>
                    <th className="text-left py-1 pr-2">D/I</th>
                    <th className="text-right py-1 pr-2">Current</th>
                    <th className="text-right py-1">Prior 2y</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.donor_diversity.map((d, i) => (
                    <tr key={i} className="border-t border-stone-100">
                      <td className="py-1.5 pr-2 text-stone-800 font-medium">{d.funder_name}</td>
                      <td className="py-1.5 pr-2">{d.funder_type}</td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            d.origin === 'international' ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-700'
                          }`}
                        >
                          {d.origin === 'international' ? 'I' : 'D'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{money(d.amount_current)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(d.amount_prior_2y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Statutory summary */}
          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-2">Statutory compliance</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-stone-500">12A</div>
                <div className="text-stone-800">{derived.statutory.reg_12a_present ? 'Present' : 'Not on file'}</div>
              </div>
              <div>
                <div className="text-stone-500">80G</div>
                <div className="text-stone-800">{derived.statutory.reg_80g_present ? 'Present' : 'Not on file'}</div>
              </div>
              <div>
                <div className="text-stone-500">FCRA valid until</div>
                <div className="text-stone-800">{derived.statutory.fcra_valid_until || '—'}</div>
              </div>
              <div>
                <div className="text-stone-500">Latest ITR</div>
                <div className="text-stone-800">
                  {derived.statutory.latest_itr_fy || '—'}
                  {derived.statutory.latest_itr_filing_date && (
                    <span className="text-stone-400"> · filed {derived.statutory.latest_itr_filing_date}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Average annual spend */}
          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-2">Average annual spend</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-stone-500">
                  <th className="text-left py-1 pr-2">FY</th>
                  <th className="text-right py-1 pr-2">Overall</th>
                  <th className="text-right py-1">Foundation share</th>
                </tr>
              </thead>
              <tbody>
                {spendFys.map((fy) => (
                  <tr key={fy} className="border-t border-stone-100">
                    <td className="py-1.5 pr-2 text-stone-800">{fy}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {money(derived.spend.by_fy_overall[fy] || 0)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-stone-500">
                      {money(derived.spend.by_fy_foundation_share[fy] || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-stone-500">
              Avg over last 3 FYs:{' '}
              <span className="text-stone-800 font-medium">{money(derived.computed_avg_last_3fy)}</span>
            </div>
          </div>

          {/* Action points */}
          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-2">
              Action points
              <span className="text-stone-400 font-normal ml-1">
                · from validation acks + judgement conditions
              </span>
            </div>
            {derived.action_points.length === 0 ? (
              <div className="text-xs text-stone-400">None.</div>
            ) : (
              <ul className="space-y-1.5 text-sm text-stone-800">
                {derived.action_points.map((ap, i) => (
                  <li key={i} className="border-l-2 border-amber-300 pl-3">
                    <div className="font-medium">{ap.title}</div>
                    <div className="text-xs text-stone-600">{ap.detail}</div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      Source: {ap.source === 'validation_ack' ? 'validation' : 'condition'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT — RP inputs */}
        <div>
          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-3">Accounting rating</div>

            <div className="mb-3">
              <div className={LABEL + ' mb-1.5'}>Accounting system</div>
              <div className="flex gap-2">
                {(['manual', 'tally', 'erp'] as const).map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => {
                      setSystem(s);
                      schedule();
                    }}
                    disabled={locked}
                    className={`text-sm px-3 py-1.5 rounded-lg border ${
                      system === s
                        ? 'bg-sky-100 border-sky-300 text-sky-800 font-medium'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    {s === 'manual' ? 'Manual' : s === 'tally' ? 'Tally' : 'ERP'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={monthlyClose}
                  onChange={(e) => {
                    setMonthlyClose(e.target.checked);
                    schedule();
                  }}
                  disabled={locked}
                />
                Monthly books close performed
              </label>
            </div>

            <div className="mb-3">
              <div className={LABEL + ' mb-1'}>Audit report URL (Vercel Blob / any accessible link)</div>
              <input
                value={auditUrl}
                onChange={(e) => {
                  setAuditUrl(e.target.value);
                  schedule();
                }}
                placeholder="https://..."
                disabled={locked}
                className={INPUT}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-stone-500">Computed score:</span>
              <span
                className={`text-xs px-2 py-1 rounded-full font-medium ${
                  SCORE_COLORS[derived.accounting.score]
                }`}
              >
                {derived.accounting.score}
              </span>
              <span className="text-xs text-stone-400 ml-auto">
                Rule: ERP + monthly close + audit → adequate; Tally + monthly close → basic; else nascent.
              </span>
            </div>
          </div>

          <div className={CARD}>
            <div className="text-sm font-semibold text-stone-800 mb-3">Grant summary</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className={LABEL + ' mb-1'}>Grant #</div>
                <input
                  type="number"
                  min={1}
                  value={grantNumber}
                  onChange={(e) => {
                    setGrantNumber(Number(e.target.value) || 1);
                    schedule();
                  }}
                  disabled={locked}
                  className={INPUT}
                />
              </div>
              <div>
                <div className={LABEL + ' mb-1'}>Value (₹)</div>
                <input
                  type="number"
                  min={0}
                  value={valueInr}
                  onChange={(e) => {
                    setValueInr(Number(e.target.value) || 0);
                    schedule();
                  }}
                  disabled={locked}
                  className={INPUT}
                />
              </div>
              <div>
                <div className={LABEL + ' mb-1'}>Duration (mo)</div>
                <input
                  type="number"
                  min={1}
                  value={durationMonths}
                  onChange={(e) => {
                    setDurationMonths(Number(e.target.value) || 12);
                    schedule();
                  }}
                  disabled={locked}
                  className={INPUT}
                />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-stone-500">Annual value</div>
                <div className="text-stone-800 font-medium">
                  {money(valueInr / Math.max(1, durationMonths / 12))}
                </div>
              </div>
              <div>
                <div className="text-stone-500">Dependency %</div>
                <div className="text-stone-800 font-medium">
                  {derived.computed_dependency_pct}%{' '}
                  <span className="text-stone-400 font-normal">
                    ({money(valueInr / Math.max(1, durationMonths / 12))} / {money(derived.computed_avg_last_3fy)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500">
          {locked ? (
            <span className="text-emerald-700 font-medium">
              Finance annexure confirmed
              {data.confirmed_at &&
                ` on ${new Date(data.confirmed_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}`}
              .
            </span>
          ) : saving ? (
            'Saving…'
          ) : savedAt ? (
            `Saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
          ) : (
            'Not saved yet'
          )}
        </div>
        {!locked && (
          <button
            type="button"
            onClick={confirm}
            disabled={confirming}
            className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
          >
            {confirming ? 'Confirming…' : 'Confirm Finance Annexure →'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}

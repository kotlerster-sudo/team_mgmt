'use client';

/**
 * Step 2 UI — deterministic validation.
 * Shows the latest rulebook run grouped by category. Each warn/fail has an
 * inline acknowledge input; "Advance to judgement" is gated on zero unresolved.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type RuleStatus = 'pass' | 'warn' | 'fail' | 'na';
type RuleCategory = 'math' | 'statutory' | 'governance' | 'beneficiary' | 'renewal' | 'coverage';

type Rule = {
  rule_id: string;
  label: string;
  category: RuleCategory;
  status: RuleStatus;
  message: string;
  details?: Record<string, unknown>;
};

type Ack = { ack_by: string; ack_at: string; note?: string };

type Latest = {
  run: {
    id: string;
    ran_at: string;
    ran_by: string;
    results: Rule[];
    acknowledgments: Record<string, Ack>;
  } | null;
  counts: { pass: number; warn: number; fail: number; na: number; acknowledged: number };
  unresolved_count: number;
};

const CATEGORY_LABEL: Record<RuleCategory, string> = {
  math: 'Cross-stage math',
  statutory: 'Statutory & compliance',
  governance: 'Governance',
  beneficiary: 'Beneficiary',
  renewal: 'Renewal-only',
  coverage: 'Coverage & meta',
};

const STATUS_STYLE: Record<RuleStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  fail: 'bg-red-100 text-red-700',
  na: 'bg-stone-100 text-stone-500',
};

export default function ValidatePanel({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  const [latest, setLatest] = useState<Latest | null>(null);
  const [busy, setBusy] = useState<null | 'run' | 'advance'>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAck, setOpenAck] = useState<string | null>(null);
  const [ackNote, setAckNote] = useState('');

  const refresh = async () => {
    const r = await fetch(`/api/approvals/${assemblyId}/validate`);
    if (r.ok) setLatest(await r.json());
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyId]);

  const runValidation = async () => {
    setError(null);
    setBusy('run');
    const r = await fetch(`/api/approvals/${assemblyId}/validate/run`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Run failed (${r.status})`);
      return;
    }
    await refresh();
  };

  const advance = async () => {
    setError(null);
    setBusy('advance');
    const r = await fetch(`/api/approvals/${assemblyId}/validate/advance`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Advance failed (${r.status})`);
      return;
    }
    router.refresh();
  };

  const ack = async (rule_id: string, note?: string) => {
    const r = await fetch(`/api/approvals/${assemblyId}/validate/ack`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rule_id, note, action: 'ack' }),
    });
    if (r.ok) {
      setOpenAck(null);
      setAckNote('');
      await refresh();
    }
  };

  const unack = async (rule_id: string) => {
    await fetch(`/api/approvals/${assemblyId}/validate/ack`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rule_id, action: 'unack' }),
    });
    await refresh();
  };

  if (!latest) return <div className="text-xs text-stone-400">Loading…</div>;

  if (!latest.run) {
    return (
      <div>
        <p className="text-sm text-stone-600 mb-3">
          Deterministic checks over partner data + DD. No LLM. Every warn or fail must be
          acknowledged before advancing to Judgement.
        </p>
        <button
          type="button"
          onClick={runValidation}
          disabled={busy !== null}
          className="bg-sky-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-700 disabled:bg-stone-300"
        >
          {busy === 'run' ? 'Running…' : 'Run validation'}
        </button>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      </div>
    );
  }

  const groups: Record<RuleCategory, Rule[]> = {
    math: [], statutory: [], governance: [], beneficiary: [], renewal: [], coverage: [],
  };
  for (const r of latest.run.results) groups[r.category].push(r);

  const { counts, unresolved_count } = latest;
  const canAdvance = unresolved_count === 0;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLE.pass}`}>
          {counts.pass} pass
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLE.warn}`}>
          {counts.warn} warn
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLE.fail}`}>
          {counts.fail} fail
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLE.na}`}>
          {counts.na} n/a
        </span>
        <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">
          {counts.acknowledged} acknowledged
        </span>
        <span className="ml-auto text-xs text-stone-400">
          Last run{' '}
          {new Date(latest.run.ran_at).toLocaleString('en-IN', {
            day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
          })}
        </span>
        <button
          type="button"
          onClick={runValidation}
          disabled={busy !== null}
          className="text-xs text-sky-600 hover:text-sky-700"
        >
          {busy === 'run' ? 'Running…' : 'Re-run'}
        </button>
      </div>

      {(Object.entries(groups) as [RuleCategory, Rule[]][])
        .filter(([, rules]) => rules.length > 0)
        .map(([cat, rules]) => (
          <div key={cat} className="mb-4">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
              {CATEGORY_LABEL[cat]}
            </div>
            <div className="space-y-1.5">
              {rules.map((r) => {
                const acked = latest.run!.acknowledgments[r.rule_id];
                const needsAck = (r.status === 'warn' || r.status === 'fail') && !acked;
                return (
                  <div
                    key={r.rule_id}
                    className={`border rounded-lg p-3 ${
                      needsAck ? 'border-amber-200 bg-amber-50/40' : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>
                        {r.status}
                      </span>
                      <span className="text-sm text-stone-800 font-medium">{r.label}</span>
                    </div>
                    <div className="text-xs text-stone-600 mt-1">{r.message}</div>

                    {acked && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700">
                        <span>
                          ✓ Acknowledged{' '}
                          {new Date(acked.ack_at).toLocaleString('en-IN', {
                            day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                        {acked.note && <span className="italic text-stone-600">— {acked.note}</span>}
                        <button
                          type="button"
                          onClick={() => unack(r.rule_id)}
                          className="ml-auto text-xs text-stone-400 hover:text-red-500"
                        >
                          Retract
                        </button>
                      </div>
                    )}

                    {needsAck && openAck !== r.rule_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAck(r.rule_id);
                          setAckNote('');
                        }}
                        className="mt-2 text-xs text-amber-700 hover:text-amber-800 underline"
                      >
                        Acknowledge
                      </button>
                    )}

                    {needsAck && openAck === r.rule_id && (
                      <div className="mt-2 flex gap-2 items-center">
                        <input
                          value={ackNote}
                          onChange={(e) => setAckNote(e.target.value)}
                          placeholder="Optional note (why the RP is proceeding)"
                          maxLength={200}
                          className="border border-stone-200 rounded-lg px-2 py-1 text-xs w-full focus:outline-none focus:border-amber-400"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => ack(r.rule_id, ackNote.trim() || undefined)}
                          className="text-xs bg-amber-600 text-white px-3 py-1 rounded-lg hover:bg-amber-700"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenAck(null)}
                          className="text-xs text-stone-500 hover:text-stone-800"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      <div className="mt-4 flex items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl p-4">
        <div className="text-sm text-stone-600">
          {canAdvance
            ? 'All rules pass or acknowledged. You may advance to Judgement.'
            : `${unresolved_count} rule(s) still need acknowledgment before advancing.`}
        </div>
        <button
          type="button"
          onClick={advance}
          disabled={!canAdvance || busy !== null}
          className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
        >
          {busy === 'advance' ? 'Advancing…' : 'Advance to Judgement →'}
        </button>
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}

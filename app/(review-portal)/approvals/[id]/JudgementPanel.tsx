'use client';

/**
 * Step 3 — the RP's structured judgement.
 * All controls are picklists / scales / typed tag rows. No free-form prose.
 * Autosaves every 1.5 s after change. Submit runs full Zod on the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';
const LABEL = 'text-xs font-medium text-stone-600';
const INPUT =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full disabled:bg-stone-50';

const STRENGTH_TAGS = [
  { value: 'leadership', label: 'Leadership' },
  { value: 'governance', label: 'Governance' },
  { value: 'financial_systems', label: 'Financial systems' },
  { value: 'delivery_discipline', label: 'Delivery discipline' },
  { value: 'community_trust', label: 'Community trust' },
] as const;

const CONCERN_TAGS = [
  { value: 'dependency', label: 'Dependency' },
  { value: 'turnover', label: 'Turnover' },
  { value: 'statutory_drift', label: 'Statutory drift' },
  { value: 'governance_thin', label: 'Governance thin' },
  { value: 'other', label: 'Other' },
] as const;

const RISK_CATEGORIES = [
  { value: 'governance', label: 'Governance' },
  { value: 'financial', label: 'Financial' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'reputational', label: 'Reputational' },
  { value: 'other', label: 'Other' },
] as const;

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
] as const;

const WORKED_WELL_TAGS = [
  { value: 'delivery_on_time', label: 'Delivery on time' },
  { value: 'financial_reporting', label: 'Financial reporting' },
  { value: 'community_engagement', label: 'Community engagement' },
  { value: 'staff_retention', label: 'Staff retention' },
  { value: 'systems_improved', label: 'Systems improved' },
  { value: 'partnerships_deepened', label: 'Partnerships deepened' },
  { value: 'other', label: 'Other' },
] as const;

const DIDNT_WORK_TAGS = [
  { value: 'targets_missed', label: 'Targets missed' },
  { value: 'reporting_delays', label: 'Reporting delays' },
  { value: 'staff_turnover', label: 'Staff turnover' },
  { value: 'financial_variance', label: 'Financial variance' },
  { value: 'systems_stalled', label: 'Systems stalled' },
  { value: 'other', label: 'Other' },
] as const;

type PddEffect = { id: string; effect: string };

type HR = {
  rating?: number;
  strengths?: string[];
  concerns?: { category: string; rationale?: string }[];
};
type EC = Record<string, { confidence: 'high' | 'medium' | 'low'; note?: string }>;
type PGE = {
  worked_well?: string[];
  didnt_work?: string[];
  overall_rating?: number;
  key_learning?: string;
} | null;
type Risk = { category: string; severity: 'low' | 'medium' | 'high'; note?: string };
type Cond = { title: string; amount_linked: boolean; description: string };

function TagPicker<T extends string>({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: readonly { value: T; label: string }[];
  selected: T[];
  onToggle: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            disabled={disabled}
            onClick={() => onToggle(o.value)}
            className={`text-xs px-2 py-1 rounded-full border ${
              on
                ? 'bg-sky-100 border-sky-300 text-sky-800'
                : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RatingScale({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`w-8 h-8 rounded-lg text-sm border ${
            value === n
              ? 'bg-sky-600 border-sky-600 text-white font-medium'
              : 'bg-white border-stone-200 text-stone-600 hover:border-sky-400'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export default function JudgementPanel({
  assemblyId,
  docType,
}: {
  assemblyId: string;
  docType: string;
}) {
  const router = useRouter();
  const [honest, setHonest] = useState<HR>({});
  const [effects, setEffects] = useState<PddEffect[]>([]);
  const [effectConf, setEffectConf] = useState<EC>({});
  const [pge, setPge] = useState<PGE>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [locked, setLocked] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitIssues, setSubmitIssues] = useState<{ path: (string | number)[]; message: string }[]>([]);

  const dirtyRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/approvals/${assemblyId}/judgement`);
      if (!r.ok) return;
      const d = await r.json();
      setLocked(!!d.locked);
      const j = d.judgement || {};
      setHonest((j.honest_read as HR) || {});
      setEffectConf((j.effect_confidence as EC) || {});
      setPge((j.prior_grant_experience as PGE) ?? null);
      setRisks((j.risks as Risk[]) || []);
      setRecommendation(j.recommendation ?? null);
      setConditions((j.conditions as Cond[]) || []);
      const partner = d.partner;
      const pddEffects = (partner?.pdd as { effects?: PddEffect[] } | undefined)?.effects || [];
      setEffects(pddEffects);
    })();
  }, [assemblyId]);

  const flush = useCallback(async () => {
    const payload = { ...dirtyRef.current };
    if (Object.keys(payload).length === 0) return;
    dirtyRef.current = {};
    setSaving(true);
    const r = await fetch(`/api/approvals/${assemblyId}/judgement`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r.ok) {
      const d = await r.json();
      setSavedAt(d.saved_at);
    }
  }, [assemblyId]);

  const schedule = useCallback(
    (patch: Record<string, unknown>) => {
      if (locked) return;
      dirtyRef.current = { ...dirtyRef.current, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 1500);
    },
    [flush, locked],
  );

  const submit = async () => {
    setSubmitError(null);
    setSubmitIssues([]);
    await flush();
    setSubmitting(true);
    const r = await fetch(`/api/approvals/${assemblyId}/judgement/submit`, { method: 'POST' });
    setSubmitting(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setSubmitError(d?.error || `Submit failed (${r.status})`);
      if (Array.isArray(d?.issues)) setSubmitIssues(d.issues);
      return;
    }
    router.refresh();
  };

  // Helpers to mutate + save
  const toggleStrength = (v: (typeof STRENGTH_TAGS)[number]['value']) => {
    const cur = honest.strengths || [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    const nh: HR = { ...honest, strengths: next };
    setHonest(nh);
    schedule({ honest_read: nh });
  };
  const toggleConcern = (v: string) => {
    const cur = honest.concerns || [];
    const found = cur.find((c) => c.category === v);
    const next = found ? cur.filter((c) => c.category !== v) : [...cur, { category: v }];
    const nh: HR = { ...honest, concerns: next };
    setHonest(nh);
    schedule({ honest_read: nh });
  };
  const setConcernRationale = (cat: string, note: string) => {
    const cur = honest.concerns || [];
    const next = cur.map((c) => (c.category === cat ? { ...c, rationale: note } : c));
    const nh: HR = { ...honest, concerns: next };
    setHonest(nh);
    schedule({ honest_read: nh });
  };
  const setEc = (id: string, patch: Partial<EC[string]>) => {
    const prev = effectConf[id] || { confidence: 'medium' as const };
    const nec: EC = { ...effectConf, [id]: { ...prev, ...patch } };
    setEffectConf(nec);
    schedule({ effect_confidence: nec });
  };
  const setPgeField = <K extends keyof NonNullable<PGE>>(k: K, v: NonNullable<PGE>[K]) => {
    const np: NonNullable<PGE> = { ...(pge || {}), [k]: v };
    setPge(np);
    schedule({ prior_grant_experience: np });
  };

  const isRenewal = docType === 'standard_renewal';

  return (
    <div>
      <p className="text-sm text-stone-600 mb-3">
        RP judgement. Structured only — every field is a picklist or a scale. Autosaves as you go.
      </p>

      {/* Honest read */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-3">Honest read of the organisation</div>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <div className={LABEL + ' mb-1.5'}>Overall rating (1 = weak, 5 = strong)</div>
            <RatingScale
              value={honest.rating}
              onChange={(n) => {
                const nh: HR = { ...honest, rating: n };
                setHonest(nh);
                schedule({ honest_read: nh });
              }}
              disabled={locked}
            />
          </div>
          <div>
            <div className={LABEL + ' mb-1.5'}>Strengths</div>
            <TagPicker
              options={STRENGTH_TAGS}
              selected={(honest.strengths || []) as never}
              onToggle={toggleStrength}
              disabled={locked}
            />
          </div>
          <div>
            <div className={LABEL + ' mb-1.5'}>Concerns</div>
            <TagPicker
              options={CONCERN_TAGS}
              selected={((honest.concerns || []).map((c) => c.category)) as never}
              onToggle={(v) => toggleConcern(v)}
              disabled={locked}
            />
            {(honest.concerns || []).length > 0 && (
              <div className="mt-2 space-y-1.5">
                {(honest.concerns || []).map((c) => (
                  <div key={c.category} className="flex gap-2 items-center">
                    <span className="text-xs text-stone-500 w-24">
                      {CONCERN_TAGS.find((t) => t.value === c.category)?.label}
                    </span>
                    <input
                      value={c.rationale || ''}
                      onChange={(e) => setConcernRationale(c.category, e.target.value)}
                      placeholder="One-line rationale (optional)"
                      maxLength={200}
                      disabled={locked}
                      className={INPUT}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Effect confidence */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-3">Effect confidence</div>
        {effects.length === 0 && (
          <div className="text-xs text-stone-400">
            No effects listed in Step 1 — nothing to score.
          </div>
        )}
        {effects.map((e) => (
          <div key={e.id} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center py-2 border-b border-stone-100 last:border-b-0">
            <div className="text-sm text-stone-800">{e.effect}</div>
            <div className="flex gap-1">
              {(['high', 'medium', 'low'] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  disabled={locked}
                  onClick={() => setEc(e.id, { confidence: c })}
                  className={`text-xs px-2 py-1 rounded-full border ${
                    effectConf[e.id]?.confidence === c
                      ? c === 'high'
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                        : c === 'medium'
                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                          : 'bg-red-100 border-red-300 text-red-800'
                      : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              value={effectConf[e.id]?.note || ''}
              onChange={(ev) => setEc(e.id, { note: ev.target.value })}
              placeholder={
                effectConf[e.id]?.confidence === 'low' ? 'Why low? (required)' : 'Optional note'
              }
              maxLength={200}
              disabled={locked}
              className={INPUT}
            />
          </div>
        ))}
      </div>

      {/* Renewal-only: prior grant experience */}
      {isRenewal && (
        <div className={CARD}>
          <div className="text-sm font-semibold text-stone-800 mb-3">
            Prior-grant experience <span className="text-xs text-amber-700 font-normal">(renewal only)</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className={LABEL + ' mb-1.5'}>What worked well</div>
              <TagPicker
                options={WORKED_WELL_TAGS}
                selected={(pge?.worked_well || []) as never}
                onToggle={(v) => {
                  const cur = pge?.worked_well || [];
                  setPgeField('worked_well', cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
                }}
                disabled={locked}
              />
            </div>
            <div>
              <div className={LABEL + ' mb-1.5'}>What didn't work</div>
              <TagPicker
                options={DIDNT_WORK_TAGS}
                selected={(pge?.didnt_work || []) as never}
                onToggle={(v) => {
                  const cur = pge?.didnt_work || [];
                  setPgeField('didnt_work', cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
                }}
                disabled={locked}
              />
            </div>
            <div>
              <div className={LABEL + ' mb-1.5'}>Overall rating for the ending grant</div>
              <RatingScale
                value={pge?.overall_rating}
                onChange={(n) => setPgeField('overall_rating', n)}
                disabled={locked}
              />
            </div>
            <div>
              <div className={LABEL + ' mb-1.5'}>Key learning (optional, one line)</div>
              <input
                value={pge?.key_learning || ''}
                onChange={(e) => setPgeField('key_learning', e.target.value)}
                maxLength={300}
                disabled={locked}
                className={INPUT}
              />
            </div>
          </div>
        </div>
      )}

      {/* Risks */}
      <div className={CARD}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-stone-800">Risks</div>
          {!locked && (
            <button
              type="button"
              onClick={() => {
                const nr: Risk[] = [...risks, { category: 'other', severity: 'medium' }];
                setRisks(nr);
                schedule({ risks: nr });
              }}
              className="text-sm text-sky-600 hover:text-sky-700 font-medium"
            >
              + Add risk
            </button>
          )}
        </div>
        {risks.length === 0 && <div className="text-xs text-stone-400">No risks recorded.</div>}
        {risks.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center mb-2">
            <select
              value={r.category}
              onChange={(e) => {
                const nr = [...risks];
                nr[i] = { ...nr[i], category: e.target.value };
                setRisks(nr);
                schedule({ risks: nr });
              }}
              disabled={locked}
              className={INPUT}
            >
              {RISK_CATEGORIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {SEVERITIES.map((s) => (
                <button
                  type="button"
                  key={s.value}
                  disabled={locked}
                  onClick={() => {
                    const nr = [...risks];
                    nr[i] = { ...nr[i], severity: s.value };
                    setRisks(nr);
                    schedule({ risks: nr });
                  }}
                  className={`text-xs px-2 py-1 rounded-full border ${
                    r.severity === s.value
                      ? s.value === 'high'
                        ? 'bg-red-100 border-red-300 text-red-800'
                        : s.value === 'medium'
                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                          : 'bg-stone-100 border-stone-300 text-stone-700'
                      : 'bg-white border-stone-200 text-stone-500'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              value={r.note || ''}
              onChange={(e) => {
                const nr = [...risks];
                nr[i] = { ...nr[i], note: e.target.value };
                setRisks(nr);
                schedule({ risks: nr });
              }}
              placeholder="Optional note"
              maxLength={200}
              disabled={locked}
              className={INPUT}
            />
            {!locked && (
              <button
                type="button"
                onClick={() => {
                  const nr = risks.filter((_, j) => j !== i);
                  setRisks(nr);
                  schedule({ risks: nr });
                }}
                className="text-xs text-stone-400 hover:text-red-500"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-3">Recommendation</div>
        <div className="flex gap-3">
          {[
            { v: 'approve', label: 'Approve', color: 'emerald' },
            { v: 'conditional', label: 'Conditional', color: 'amber' },
            { v: 'decline', label: 'Decline', color: 'red' },
          ].map((o) => (
            <label
              key={o.v}
              className={`flex-1 flex items-center gap-2 border rounded-lg p-3 cursor-pointer ${
                recommendation === o.v
                  ? o.color === 'emerald'
                    ? 'border-emerald-300 bg-emerald-50'
                    : o.color === 'amber'
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-red-300 bg-red-50'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              <input
                type="radio"
                checked={recommendation === o.v}
                onChange={() => {
                  setRecommendation(o.v);
                  schedule({ recommendation: o.v });
                }}
                disabled={locked}
              />
              <span className="text-sm text-stone-800">{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Conditions */}
      <div className={CARD}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-stone-800">Conditions (term-sheet)</div>
          {!locked && (
            <button
              type="button"
              onClick={() => {
                const nc: Cond[] = [...conditions, { title: '', amount_linked: false, description: '' }];
                setConditions(nc);
                schedule({ conditions: nc });
              }}
              className="text-sm text-sky-600 hover:text-sky-700 font-medium"
            >
              + Add condition
            </button>
          )}
        </div>
        {conditions.length === 0 && (
          <div className="text-xs text-stone-400">No conditions recorded.</div>
        )}
        {conditions.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 items-center mb-2">
            <input
              value={c.title}
              onChange={(e) => {
                const nc = [...conditions];
                nc[i] = { ...nc[i], title: e.target.value };
                setConditions(nc);
                schedule({ conditions: nc });
              }}
              placeholder="Short title"
              maxLength={100}
              disabled={locked}
              className={INPUT}
            />
            <label className="flex items-center gap-1 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={c.amount_linked}
                onChange={(e) => {
                  const nc = [...conditions];
                  nc[i] = { ...nc[i], amount_linked: e.target.checked };
                  setConditions(nc);
                  schedule({ conditions: nc });
                }}
                disabled={locked}
              />
              $-linked
            </label>
            <input
              value={c.description}
              onChange={(e) => {
                const nc = [...conditions];
                nc[i] = { ...nc[i], description: e.target.value };
                setConditions(nc);
                schedule({ conditions: nc });
              }}
              placeholder="One-line description"
              maxLength={300}
              disabled={locked}
              className={INPUT}
            />
            {!locked && (
              <button
                type="button"
                onClick={() => {
                  const nc = conditions.filter((_, j) => j !== i);
                  setConditions(nc);
                  schedule({ conditions: nc });
                }}
                className="text-xs text-stone-400 hover:text-red-500"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Submit bar */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500">
          {locked ? (
            <span className="text-emerald-700 font-medium">Judgement submitted — read only.</span>
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
            onClick={submit}
            disabled={submitting}
            className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
          >
            {submitting ? 'Submitting…' : 'Submit Judgement →'}
          </button>
        )}
      </div>

      {submitError && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="font-medium mb-1">{submitError}</div>
          {submitIssues.length > 0 && (
            <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5">
              {submitIssues.slice(0, 15).map((i, idx) => (
                <li key={idx}>
                  <span className="font-mono">{i.path.join('.')}</span>: {i.message}
                </li>
              ))}
              {submitIssues.length > 15 && <li>… and {submitIssues.length - 15} more.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

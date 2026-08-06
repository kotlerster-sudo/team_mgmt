'use client';

import type {
  PddEffect,
  PddIntervention,
  PddTeamRow,
  PriorGrantSummary,
} from '@/lib/approvals/schema';
import {
  CARD,
  Field,
  TextInput,
  EnumSelect,
  NumberInput,
  TEXTAREA,
  SectionHeader,
  REMOVE_BTN,
  ADD_BTN,
  newId,
} from './_shared';

const VULNERABLE = [
  { value: 'urban_poor', label: 'Urban poor' },
  { value: 'rural_poor', label: 'Rural poor' },
  { value: 'tribal', label: 'Tribal' },
  { value: 'dalit', label: 'Dalit' },
  { value: 'women', label: 'Women' },
  { value: 'children_under_5', label: 'Children under 5' },
  { value: 'children_5_18', label: 'Children 5–18' },
  { value: 'elderly', label: 'Elderly' },
  { value: 'pwd', label: 'PWD' },
  { value: 'lgbtqia', label: 'LGBTQIA+' },
  { value: 'migrant', label: 'Migrant' },
  { value: 'homeless', label: 'Homeless' },
  { value: 'other', label: 'Other' },
] as const;

const BENEFICIARY_TYPES = [
  { value: 'child', label: 'Child' },
  { value: 'youth', label: 'Youth' },
  { value: 'adult', label: 'Adult' },
  { value: 'woman', label: 'Woman' },
  { value: 'elder', label: 'Elder' },
  { value: 'family', label: 'Family' },
  { value: 'household', label: 'Household' },
  { value: 'community', label: 'Community' },
  { value: 'other', label: 'Other' },
] as const;

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
  { value: 'one_time', label: 'One-time' },
] as const;

const METHODS = [
  { value: 'count', label: 'Direct count' },
  { value: 'sample_survey', label: 'Sample survey' },
  { value: 'admin_records', label: 'Admin records' },
  { value: 'observation', label: 'Observation' },
  { value: 'other', label: 'Other' },
] as const;

const TEAM_CATS = [
  { value: 'programme', label: 'Programme' },
  { value: 'admin', label: 'Admin' },
  { value: 'other', label: 'Other' },
] as const;

type PddValue = {
  context?: {
    geography_districts?: string[];
    vulnerable_populations?: string[];
    problem_statement?: string;
    scale_metrics?: { metric: string; value: number; unit: string }[];
  };
  goal?: {
    primary?: string;
    measurable_outcomes?: { outcome: string; beneficiary_type: string; target_count: number }[];
  };
  history_with_foundation?: PriorGrantSummary[];
  effects?: PddEffect[];
  key_interventions?: PddIntervention[];
  people_involved?: PddTeamRow[];
};

export default function PddSection({
  value,
  onChange,
  disabled,
}: {
  value: PddValue;
  onChange: (v: PddValue) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof PddValue>(k: K, v: PddValue[K]) => onChange({ ...value, [k]: v });

  return (
    <>
      <SectionHeader
        title="Programme design"
        hint="Context, goal, effects, and how you're staffed to deliver."
      />

      {/* Context */}
      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Context</div>
        <div className="space-y-3">
          <Field label="Districts of operation" hint="Comma-separated" required>
            <TextInput
              value={(value.context?.geography_districts || []).join(', ')}
              onValue={(v) =>
                set('context', {
                  ...(value.context || {}),
                  geography_districts: v.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              disabled={disabled}
            />
          </Field>
          <Field label="Vulnerable populations served" hint="Multi-select" required>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {VULNERABLE.map((v) => {
                const selected = (value.context?.vulnerable_populations || []).includes(v.value);
                return (
                  <button
                    type="button"
                    key={v.value}
                    disabled={disabled}
                    onClick={() => {
                      const cur = value.context?.vulnerable_populations || [];
                      const next = selected ? cur.filter((x) => x !== v.value) : [...cur, v.value];
                      set('context', { ...(value.context || {}), vulnerable_populations: next });
                    }}
                    className={`text-xs px-2 py-1 rounded-full border ${
                      selected
                        ? 'bg-sky-100 border-sky-300 text-sky-800'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Problem statement" hint="One paragraph, max 600 chars" required>
            <textarea
              value={value.context?.problem_statement || ''}
              onChange={(e) =>
                set('context', { ...(value.context || {}), problem_statement: e.target.value })
              }
              disabled={disabled}
              rows={3}
              maxLength={600}
              className={TEXTAREA}
            />
          </Field>
        </div>
      </div>

      {/* Goal */}
      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Goal</div>
        <div className="space-y-3">
          <Field label="Primary goal" required>
            <TextInput
              value={value.goal?.primary || ''}
              onValue={(v) => set('goal', { ...(value.goal || {}), primary: v })}
              disabled={disabled}
            />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-stone-600">Measurable outcomes</span>
              {!disabled && (
                <button
                  type="button"
                  className={ADD_BTN}
                  onClick={() =>
                    set('goal', {
                      ...(value.goal || {}),
                      measurable_outcomes: [
                        ...(value.goal?.measurable_outcomes || []),
                        { outcome: '', beneficiary_type: 'community', target_count: 0 },
                      ],
                    })
                  }
                >
                  + Add outcome
                </button>
              )}
            </div>
            {(value.goal?.measurable_outcomes || []).map((o, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 mb-2 items-end">
                <div className="col-span-2">
                  <TextInput
                    value={o.outcome}
                    onValue={(v) => {
                      const arr = [...(value.goal?.measurable_outcomes || [])];
                      arr[i] = { ...arr[i], outcome: v };
                      set('goal', { ...(value.goal || {}), measurable_outcomes: arr });
                    }}
                    placeholder="What outcome?"
                    disabled={disabled}
                  />
                </div>
                <EnumSelect
                  value={o.beneficiary_type as (typeof BENEFICIARY_TYPES)[number]['value']}
                  onChange={(v) => {
                    const arr = [...(value.goal?.measurable_outcomes || [])];
                    arr[i] = { ...arr[i], beneficiary_type: v };
                    set('goal', { ...(value.goal || {}), measurable_outcomes: arr });
                  }}
                  options={BENEFICIARY_TYPES}
                  disabled={disabled}
                />
                <div className="flex gap-2 items-center">
                  <NumberInput
                    value={o.target_count}
                    onChange={(v) => {
                      const arr = [...(value.goal?.measurable_outcomes || [])];
                      arr[i] = { ...arr[i], target_count: v };
                      set('goal', { ...(value.goal || {}), measurable_outcomes: arr });
                    }}
                    disabled={disabled}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => {
                        const arr = (value.goal?.measurable_outcomes || []).filter((_, j) => j !== i);
                        set('goal', { ...(value.goal || {}), measurable_outcomes: arr });
                      }}
                      className={REMOVE_BTN}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Effects */}
      <div className={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-stone-700">Effects</div>
          {!disabled && (
            <button
              type="button"
              className={ADD_BTN}
              onClick={() =>
                set('effects', [
                  ...(value.effects || []),
                  {
                    id: newId(),
                    effect: '',
                    beneficiary_type: 'community',
                    count: 0,
                    method: 'other',
                  },
                ])
              }
            >
              + Add effect
            </button>
          )}
        </div>
        {(value.effects || []).map((e, i) => (
          <div key={e.id} className="grid grid-cols-5 gap-2 mb-2 items-end">
            <div className="col-span-2">
              <TextInput
                value={e.effect}
                onValue={(v) => {
                  const arr = [...(value.effects || [])];
                  arr[i] = { ...arr[i], effect: v };
                  set('effects', arr);
                }}
                placeholder="Effect description"
                disabled={disabled}
              />
            </div>
            <EnumSelect
              value={e.beneficiary_type}
              onChange={(v) => {
                const arr = [...(value.effects || [])];
                arr[i] = { ...arr[i], beneficiary_type: v };
                set('effects', arr);
              }}
              options={BENEFICIARY_TYPES}
              disabled={disabled}
            />
            <NumberInput
              value={e.count}
              onChange={(v) => {
                const arr = [...(value.effects || [])];
                arr[i] = { ...arr[i], count: v };
                set('effects', arr);
              }}
              disabled={disabled}
            />
            <div className="flex gap-2 items-center">
              <EnumSelect
                value={e.method}
                onChange={(v) => {
                  const arr = [...(value.effects || [])];
                  arr[i] = { ...arr[i], method: v };
                  set('effects', arr);
                }}
                options={METHODS}
                disabled={disabled}
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => set('effects', (value.effects || []).filter((_, j) => j !== i))}
                  className={REMOVE_BTN}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Key interventions */}
      <div className={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-stone-700">Key interventions</div>
          {!disabled && (
            <button
              type="button"
              className={ADD_BTN}
              onClick={() =>
                set('key_interventions', [
                  ...(value.key_interventions || []),
                  { intervention: '', frequency: 'monthly', target_count: 0, responsible_role: '' },
                ])
              }
            >
              + Add intervention
            </button>
          )}
        </div>
        {(value.key_interventions || []).map((it, i) => (
          <div key={i} className="grid grid-cols-5 gap-2 mb-2 items-end">
            <div className="col-span-2">
              <TextInput
                value={it.intervention}
                onValue={(v) => {
                  const arr = [...(value.key_interventions || [])];
                  arr[i] = { ...arr[i], intervention: v };
                  set('key_interventions', arr);
                }}
                placeholder="What you do"
                disabled={disabled}
              />
            </div>
            <EnumSelect
              value={it.frequency}
              onChange={(v) => {
                const arr = [...(value.key_interventions || [])];
                arr[i] = { ...arr[i], frequency: v };
                set('key_interventions', arr);
              }}
              options={FREQUENCIES}
              disabled={disabled}
            />
            <NumberInput
              value={it.target_count}
              onChange={(v) => {
                const arr = [...(value.key_interventions || [])];
                arr[i] = { ...arr[i], target_count: v };
                set('key_interventions', arr);
              }}
              disabled={disabled}
            />
            <div className="flex gap-2 items-center">
              <TextInput
                value={it.responsible_role}
                onValue={(v) => {
                  const arr = [...(value.key_interventions || [])];
                  arr[i] = { ...arr[i], responsible_role: v };
                  set('key_interventions', arr);
                }}
                placeholder="Owned by role"
                disabled={disabled}
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() =>
                    set('key_interventions', (value.key_interventions || []).filter((_, j) => j !== i))
                  }
                  className={REMOVE_BTN}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* People involved */}
      <div className={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-stone-700">People involved</div>
          {!disabled && (
            <button
              type="button"
              className={ADD_BTN}
              onClick={() =>
                set('people_involved', [
                  ...(value.people_involved || []),
                  { category: 'programme', role: '', count: 0, fte_pct: 100 },
                ])
              }
            >
              + Add role
            </button>
          )}
        </div>
        {(value.people_involved || []).map((p, i) => (
          <div key={i} className="grid grid-cols-5 gap-2 mb-2 items-end">
            <EnumSelect
              value={p.category}
              onChange={(v) => {
                const arr = [...(value.people_involved || [])];
                arr[i] = { ...arr[i], category: v };
                set('people_involved', arr);
              }}
              options={TEAM_CATS}
              disabled={disabled}
            />
            <div className="col-span-2">
              <TextInput
                value={p.role}
                onValue={(v) => {
                  const arr = [...(value.people_involved || [])];
                  arr[i] = { ...arr[i], role: v };
                  set('people_involved', arr);
                }}
                placeholder="Role title"
                disabled={disabled}
              />
            </div>
            <NumberInput
              value={p.count}
              onChange={(v) => {
                const arr = [...(value.people_involved || [])];
                arr[i] = { ...arr[i], count: v };
                set('people_involved', arr);
              }}
              disabled={disabled}
            />
            <div className="flex gap-2 items-center">
              <NumberInput
                value={p.fte_pct}
                onChange={(v) => {
                  const arr = [...(value.people_involved || [])];
                  arr[i] = { ...arr[i], fte_pct: v };
                  set('people_involved', arr);
                }}
                disabled={disabled}
              />
              <span className="text-xs text-stone-400">% FTE</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() =>
                    set('people_involved', (value.people_involved || []).filter((_, j) => j !== i))
                  }
                  className={REMOVE_BTN}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

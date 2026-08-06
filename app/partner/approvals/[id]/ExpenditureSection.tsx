'use client';

import type { ExpenditureRow, FoundationPartnerGrant } from '@/lib/approvals/schema';
import {
  CARD,
  Field,
  TextInput,
  EnumSelect,
  NumberInput,
  SectionHeader,
  REMOVE_BTN,
  ADD_BTN,
  FY_LABELS,
} from './_shared';

const CATEGORIES = [
  { value: 'salary', label: 'Salary expenses' },
  { value: 'programme', label: 'Programme expenses' },
  { value: 'admin', label: 'Admin expenses' },
  { value: 'capital', label: 'Capital (construction/renovation)' },
  { value: 'one_time_relief', label: 'One-time relief' },
  { value: 'depreciation', label: 'Depreciation' },
] as const;

function emptyRow(cat: (typeof CATEGORIES)[number]['value']): ExpenditureRow {
  return { category: cat, amounts_by_fy: {} };
}

function emptyPartnerGrant(): FoundationPartnerGrant {
  return { partner_name: '', amount: 0, period_start: '', period_end: '' };
}

type ExpValue = {
  overall?: ExpenditureRow[];
  foundation_supported?: ExpenditureRow[];
  foundation_partner_grants?: FoundationPartnerGrant[];
};

function RowTable({
  title,
  rows,
  onChange,
  disabled,
}: {
  title: string;
  rows: ExpenditureRow[];
  onChange: (rows: ExpenditureRow[]) => void;
  disabled?: boolean;
}) {
  const set = (idx: number, patch: Partial<ExpenditureRow>) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const setFy = (idx: number, fy: string, v: number) =>
    set(idx, { amounts_by_fy: { ...rows[idx].amounts_by_fy, [fy]: v } });
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, emptyRow('programme')]);

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-stone-700">{title}</div>
        {!disabled && (
          <button type="button" onClick={add} className={ADD_BTN}>
            + Add row
          </button>
        )}
      </div>
      {rows.length === 0 && (
        <div className="text-xs text-stone-400 py-2">No rows.</div>
      )}
      {rows.map((r, idx) => (
        <div key={idx} className="border-t border-stone-100 pt-3 mt-3 first:mt-0 first:border-t-0 first:pt-0">
          <div className="grid grid-cols-4 gap-3 mb-2">
            <Field label="Category" required>
              <EnumSelect
                value={r.category}
                onChange={(v) => set(idx, { category: v })}
                options={CATEGORIES}
                disabled={disabled}
              />
            </Field>
            <Field label="Current-FY amount">
              <NumberInput
                value={r.current_fy_amount}
                onChange={(v) => set(idx, { current_fy_amount: v })}
                disabled={disabled}
              />
            </Field>
            <Field label="Current-FY as of">
              <TextInput
                type="date"
                value={r.current_fy_as_of || ''}
                onValue={(v) => set(idx, { current_fy_as_of: v })}
                disabled={disabled}
              />
            </Field>
            {!disabled && (
              <button type="button" onClick={() => remove(idx)} className={REMOVE_BTN + ' self-end'}>
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {FY_LABELS.map((fy) => (
              <div key={fy}>
                <div className="text-xs text-stone-500 mb-1">{fy}</div>
                <NumberInput
                  value={r.amounts_by_fy[fy] ?? 0}
                  onChange={(v) => setFy(idx, fy, v)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ExpenditureSection({
  value,
  onChange,
  disabled,
}: {
  value: ExpValue;
  onChange: (v: ExpValue) => void;
  disabled?: boolean;
}) {
  const partnerGrants = value.foundation_partner_grants ?? [];
  const setPg = (idx: number, patch: Partial<FoundationPartnerGrant>) =>
    onChange({
      ...value,
      foundation_partner_grants: partnerGrants.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    });
  const addPg = () =>
    onChange({ ...value, foundation_partner_grants: [...partnerGrants, emptyPartnerGrant()] });
  const removePg = (idx: number) =>
    onChange({
      ...value,
      foundation_partner_grants: partnerGrants.filter((_, i) => i !== idx),
    });

  return (
    <>
      <SectionHeader title="Expenditure" hint="Overall spend per FY, plus foundation-supported portion." />

      <RowTable
        title="Overall organisation expenditure"
        rows={value.overall ?? []}
        onChange={(rows) => onChange({ ...value, overall: rows })}
        disabled={disabled}
      />

      <RowTable
        title="Foundation-supported expenditure"
        rows={value.foundation_supported ?? []}
        onChange={(rows) => onChange({ ...value, foundation_supported: rows })}
        disabled={disabled}
      />

      <div className={CARD}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-stone-700">Partner-wise grants released (if any)</div>
          {!disabled && (
            <button type="button" onClick={addPg} className={ADD_BTN}>
              + Add
            </button>
          )}
        </div>
        {partnerGrants.length === 0 && (
          <div className="text-xs text-stone-400 py-2">
            Only fill this if you are a sub-granting or pass-through organisation.
          </div>
        )}
        {partnerGrants.map((g, idx) => (
          <div key={idx} className="border-t border-stone-100 pt-3 mt-3 first:mt-0 first:border-t-0 first:pt-0">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Partner name" required>
                <TextInput
                  value={g.partner_name}
                  onValue={(v) => setPg(idx, { partner_name: v })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Amount (₹)" required>
                <NumberInput
                  value={g.amount}
                  onChange={(v) => setPg(idx, { amount: v })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Period start" required>
                <TextInput
                  type="date"
                  value={g.period_start}
                  onValue={(v) => setPg(idx, { period_start: v })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Period end" required>
                <TextInput
                  type="date"
                  value={g.period_end}
                  onValue={(v) => setPg(idx, { period_end: v })}
                  disabled={disabled}
                />
              </Field>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={() => removePg(idx)}
                className={REMOVE_BTN + ' mt-2'}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

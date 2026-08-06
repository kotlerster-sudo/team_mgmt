'use client';

import type { FunderRow, OtherIncomeRow } from '@/lib/approvals/schema';
import {
  CARD,
  Field,
  TextInput,
  EnumSelect,
  NumberInput,
  SectionHeader,
  REMOVE_BTN,
  ADD_BTN,
  newId,
  FY_LABELS,
} from './_shared';

const FUNDER_TYPES = [
  { value: 'foundation', label: 'Foundation' },
  { value: 'csr', label: 'CSR' },
  { value: 'government', label: 'Government' },
  { value: 'fcra_international', label: 'International (FCRA)' },
  { value: 'individual', label: 'Individual' },
  { value: 'other', label: 'Other' },
] as const;

const PURPOSES = [
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'early_learning', label: 'Early learning' },
  { value: 'wash', label: 'WASH' },
  { value: 'health', label: 'Health' },
  { value: 'livelihoods', label: 'Livelihoods' },
  { value: 'education', label: 'Education' },
  { value: 'advocacy', label: 'Advocacy' },
  { value: 'capacity_building', label: 'Capacity building' },
  { value: 'unrestricted', label: 'Unrestricted' },
  { value: 'other', label: 'Other' },
] as const;

const OTHER_INCOME_SOURCES = [
  { value: 'bank_interest', label: 'Bank interest' },
  { value: 'rent', label: 'Rent' },
  { value: 'incidental', label: 'Incidental' },
  { value: 'individual_donors', label: 'Individual donors' },
  { value: 'other', label: 'Other' },
] as const;

function emptyFunder(): FunderRow {
  return {
    id: newId(),
    funder_name: '',
    funder_type: 'foundation',
    purpose: 'other',
    start_date: '',
    end_date: '',
    amounts_by_fy: {},
  };
}

function emptyOther(): OtherIncomeRow {
  return { source: 'bank_interest', amounts_by_fy: {} };
}

type FundingValue = {
  donors?: FunderRow[];
  other_income?: OtherIncomeRow[];
};

export default function FundingSection({
  value,
  onChange,
  disabled,
}: {
  value: FundingValue;
  onChange: (v: FundingValue) => void;
  disabled?: boolean;
}) {
  const donors = value.donors ?? [];
  const other = value.other_income ?? [];

  const setDonor = (idx: number, patch: Partial<FunderRow>) =>
    onChange({ ...value, donors: donors.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const addDonor = () => onChange({ ...value, donors: [...donors, emptyFunder()] });
  const removeDonor = (idx: number) => onChange({ ...value, donors: donors.filter((_, i) => i !== idx) });

  const setFy = (idx: number, fy: string, v: number) =>
    setDonor(idx, { amounts_by_fy: { ...donors[idx].amounts_by_fy, [fy]: v } });

  const setOther = (idx: number, patch: Partial<OtherIncomeRow>) =>
    onChange({
      ...value,
      other_income: other.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  const addOther = () => onChange({ ...value, other_income: [...other, emptyOther()] });
  const removeOther = (idx: number) =>
    onChange({ ...value, other_income: other.filter((_, i) => i !== idx) });

  const setOtherFy = (idx: number, fy: string, v: number) =>
    setOther(idx, { amounts_by_fy: { ...other[idx].amounts_by_fy, [fy]: v } });

  return (
    <>
      <SectionHeader
        title="Funding & income"
        hint="All funders across the past 3 FYs and current commitments."
        right={
          !disabled && (
            <button type="button" onClick={addDonor} className={ADD_BTN}>
              + Add funder
            </button>
          )
        }
      />

      {donors.length === 0 && (
        <div className="text-sm text-stone-400 text-center py-8 bg-white border border-dashed border-stone-200 rounded-xl mb-3">
          No funders yet.{' '}
          {!disabled && (
            <button type="button" onClick={addDonor} className="text-sky-600 hover:underline">
              Add the first one.
            </button>
          )}
        </div>
      )}

      {donors.map((d, idx) => (
        <div key={d.id} className={CARD}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-stone-700">Funder #{idx + 1}</div>
            {!disabled && (
              <button type="button" onClick={() => removeDonor(idx)} className={REMOVE_BTN}>
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Funder name" required>
              <TextInput
                value={d.funder_name}
                onValue={(v) => setDonor(idx, { funder_name: v })}
                disabled={disabled}
              />
            </Field>
            <Field label="Type" required>
              <EnumSelect
                value={d.funder_type}
                onChange={(v) => setDonor(idx, { funder_type: v })}
                options={FUNDER_TYPES}
                disabled={disabled}
              />
            </Field>
            <Field label="Purpose" required>
              <EnumSelect
                value={d.purpose}
                onChange={(v) => setDonor(idx, { purpose: v })}
                options={PURPOSES}
                disabled={disabled}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" required>
                <TextInput
                  type="date"
                  value={d.start_date}
                  onValue={(v) => setDonor(idx, { start_date: v })}
                  disabled={disabled}
                />
              </Field>
              <Field label="End date" required>
                <TextInput
                  type="date"
                  value={d.end_date}
                  onValue={(v) => setDonor(idx, { end_date: v })}
                  disabled={disabled}
                />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {FY_LABELS.map((fy) => (
              <div key={fy}>
                <div className="text-xs text-stone-500 mb-1">{fy}</div>
                <NumberInput
                  value={d.amounts_by_fy[fy] ?? 0}
                  onChange={(v) => setFy(idx, fy, v)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={CARD}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-stone-700">Other income</div>
          {!disabled && (
            <button type="button" onClick={addOther} className={ADD_BTN}>
              + Add source
            </button>
          )}
        </div>
        {other.length === 0 && (
          <div className="text-xs text-stone-400 py-2">No other income sources.</div>
        )}
        {other.map((o, idx) => (
          <div key={idx} className="border-t border-stone-100 pt-3 mt-3 first:mt-0 first:border-t-0 first:pt-0">
            <div className="grid grid-cols-2 gap-3 mb-2">
              <Field label="Source">
                <EnumSelect
                  value={o.source}
                  onChange={(v) => setOther(idx, { source: v })}
                  options={OTHER_INCOME_SOURCES}
                  disabled={disabled}
                />
              </Field>
              {o.source === 'other' && (
                <Field label="Describe">
                  <TextInput
                    value={o.label || ''}
                    onValue={(v) => setOther(idx, { label: v })}
                    disabled={disabled}
                  />
                </Field>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeOther(idx)}
                  className={REMOVE_BTN + ' self-end'}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {FY_LABELS.map((fy) => (
                <div key={fy}>
                  <div className="text-xs text-stone-500 mb-1">{fy}</div>
                  <NumberInput
                    value={o.amounts_by_fy[fy] ?? 0}
                    onChange={(v) => setOtherFy(idx, fy, v)}
                    disabled={disabled}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

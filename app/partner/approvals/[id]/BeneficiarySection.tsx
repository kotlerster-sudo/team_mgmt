'use client';

import { CARD, Field, NumberInput, TextInput, SectionHeader, TEXTAREA } from './_shared';

type BValue = {
  per_year?: number;
  lifetime?: number;
  notes?: string;
};

export default function BeneficiarySection({
  value,
  onChange,
  disabled,
}: {
  value: BValue;
  onChange: (v: BValue) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <SectionHeader
        title="Beneficiary targets"
        hint="Used to compute cost-per-beneficiary and compare with similar past grants."
      />
      <div className={CARD}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Beneficiaries per year" hint="Distinct people the programme reaches each year" required>
            <NumberInput
              value={value.per_year}
              onChange={(v) => onChange({ ...value, per_year: v })}
              disabled={disabled}
            />
          </Field>
          <Field label="Lifetime beneficiaries (optional)" hint="Cumulative reach over grant duration">
            <NumberInput
              value={value.lifetime}
              onChange={(v) => onChange({ ...value, lifetime: v })}
              disabled={disabled}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes on how you counted (optional)">
            <textarea
              value={value.notes || ''}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              disabled={disabled}
              rows={2}
              maxLength={200}
              className={TEXTAREA}
              placeholder="e.g. Kids enrolled in creche each academic year; families reached via home visits."
            />
          </Field>
        </div>
      </div>
    </>
  );
}

'use client';

import type { BoardMember } from '@/lib/approvals/schema';
import { CARD, Field, TextInput, EnumSelect, NumberInput, SectionHeader, REMOVE_BTN, ADD_BTN, newId } from './_shared';

const ROLES = [
  { value: 'president', label: 'President' },
  { value: 'vice_president', label: 'Vice President' },
  { value: 'secretary', label: 'Secretary' },
  { value: 'joint_secretary', label: 'Joint Secretary' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'member', label: 'Member' },
  { value: 'patron', label: 'Patron' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'other', label: 'Other' },
] as const;

const OCCUPATIONS = [
  { value: 'business', label: 'Business' },
  { value: 'service', label: 'Service' },
  { value: 'retired', label: 'Retired' },
  { value: 'ngo', label: 'NGO / social sector' },
  { value: 'government', label: 'Government' },
  { value: 'education', label: 'Education' },
  { value: 'other', label: 'Other' },
] as const;

const EDUCATION = [
  { value: 'below_12', label: 'Below 12th' },
  { value: 'class_12', label: '12th' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'post_graduate', label: 'Post-graduate' },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'other', label: 'Other' },
] as const;

const POL_EXPOSURE = [
  { value: 'none', label: 'None' },
  { value: 'past', label: 'Past' },
  { value: 'current', label: 'Current' },
] as const;

function emptyMember(): BoardMember {
  return {
    id: newId(),
    name: '',
    role: 'member',
    address_city: '',
    tenure_board_years: 0,
    tenure_position_years: 0,
    occupation: 'other',
    education: 'other',
    political_exposure: 'none',
    related_parties: [],
    other_institutions: [],
    flags: [],
  };
}

export default function GoverningBodySection({
  value,
  onChange,
  disabled,
}: {
  value: BoardMember[];
  onChange: (v: BoardMember[]) => void;
  disabled?: boolean;
}) {
  const setRow = (idx: number, patch: Partial<BoardMember>) =>
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...value, emptyMember()]);
  const removeRow = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <>
      <SectionHeader
        title="Governing body"
        hint="Board members, trustees, and their profiles."
        right={
          !disabled && (
            <button type="button" onClick={addRow} className={ADD_BTN}>
              + Add member
            </button>
          )
        }
      />

      {value.length === 0 && (
        <div className="text-sm text-stone-400 text-center py-8 bg-white border border-dashed border-stone-200 rounded-xl">
          No board members yet.{' '}
          {!disabled && (
            <button type="button" onClick={addRow} className="text-sky-600 hover:underline">
              Add the first one.
            </button>
          )}
        </div>
      )}

      {value.map((m, idx) => (
        <div key={m.id} className={CARD}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-stone-700">Member #{idx + 1}</div>
            {!disabled && (
              <button type="button" onClick={() => removeRow(idx)} className={REMOVE_BTN}>
                Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" required>
              <TextInput value={m.name} onValue={(v) => setRow(idx, { name: v })} disabled={disabled} />
            </Field>
            <Field label="Role" required>
              <EnumSelect
                value={m.role}
                onChange={(v) => setRow(idx, { role: v })}
                options={ROLES}
                disabled={disabled}
              />
            </Field>
            <Field label="City" required>
              <TextInput
                value={m.address_city}
                onValue={(v) => setRow(idx, { address_city: v })}
                disabled={disabled}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <TextInput
                  value={m.phone || ''}
                  onValue={(v) => setRow(idx, { phone: v })}
                  disabled={disabled}
                  inputMode="tel"
                />
              </Field>
              <Field label="Email">
                <TextInput
                  type="email"
                  value={m.email || ''}
                  onValue={(v) => setRow(idx, { email: v })}
                  disabled={disabled}
                />
              </Field>
            </div>
            <Field label="Tenure on board (years)" required>
              <NumberInput
                value={m.tenure_board_years}
                onChange={(v) => setRow(idx, { tenure_board_years: v })}
                disabled={disabled}
              />
            </Field>
            <Field label="Tenure in this position (years)" required>
              <NumberInput
                value={m.tenure_position_years}
                onChange={(v) => setRow(idx, { tenure_position_years: v })}
                disabled={disabled}
              />
            </Field>
            <Field label="Occupation" required>
              <EnumSelect
                value={m.occupation}
                onChange={(v) => setRow(idx, { occupation: v })}
                options={OCCUPATIONS}
                disabled={disabled}
              />
            </Field>
            <Field label="Education" required>
              <EnumSelect
                value={m.education}
                onChange={(v) => setRow(idx, { education: v })}
                options={EDUCATION}
                disabled={disabled}
              />
            </Field>
            <Field label="Political exposure" required>
              <EnumSelect
                value={m.political_exposure}
                onChange={(v) => setRow(idx, { political_exposure: v })}
                options={POL_EXPOSURE}
                disabled={disabled}
              />
            </Field>
          </div>
        </div>
      ))}
    </>
  );
}

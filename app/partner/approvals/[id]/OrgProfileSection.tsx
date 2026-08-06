'use client';

import type { OrgProfile as OrgProfileT } from '@/lib/approvals/schema';
import { CARD, Field, TextInput, EnumSelect, SectionHeader } from './_shared';

const REG_TYPES = [
  { value: 'society', label: 'Society' },
  { value: 'trust', label: 'Trust' },
  { value: 'section_8', label: 'Section 8 Company' },
] as const;

type PartialOrgProfile = Partial<Omit<OrgProfileT, 'chief_functionary' | 'finance_person'>> & {
  chief_functionary?: Partial<OrgProfileT['chief_functionary']>;
  finance_person?: Partial<OrgProfileT['finance_person']>;
  registered_address?: Partial<OrgProfileT['registered_address']>;
  admin_office_address?: Partial<OrgProfileT['admin_office_address']>;
};

export default function OrgProfileSection({
  value,
  onChange,
  disabled,
}: {
  value: PartialOrgProfile;
  onChange: (v: PartialOrgProfile) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<PartialOrgProfile>) => onChange({ ...value, ...patch });
  const setAddr = (
    key: 'registered_address' | 'admin_office_address',
    field: keyof OrgProfileT['registered_address'],
    v: string,
  ) => onChange({ ...value, [key]: { ...(value[key] || {}), [field]: v } });
  const setPerson = (key: 'chief_functionary' | 'finance_person', field: string, v: string) =>
    onChange({ ...value, [key]: { ...(value[key] || {}), [field]: v } });

  return (
    <>
      <SectionHeader title="Organisation profile" hint="Legal identity, addresses, registration, key contacts." />

      <div className={CARD}>
        <Field label="Registered legal name" required>
          <TextInput value={value.legal_name || ''} onValue={(v) => set({ legal_name: v })} disabled={disabled} />
        </Field>
      </div>

      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Registered address</div>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Address line 1" required>
            <TextInput
              value={value.registered_address?.line1 || ''}
              onValue={(v) => setAddr('registered_address', 'line1', v)}
              disabled={disabled}
            />
          </Field>
          <Field label="Address line 2 (optional)">
            <TextInput
              value={value.registered_address?.line2 || ''}
              onValue={(v) => setAddr('registered_address', 'line2', v)}
              disabled={disabled}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" required>
              <TextInput
                value={value.registered_address?.city || ''}
                onValue={(v) => setAddr('registered_address', 'city', v)}
                disabled={disabled}
              />
            </Field>
            <Field label="State" required>
              <TextInput
                value={value.registered_address?.state || ''}
                onValue={(v) => setAddr('registered_address', 'state', v)}
                disabled={disabled}
              />
            </Field>
            <Field label="Pincode" hint="6-digit PIN" required>
              <TextInput
                value={value.registered_address?.pincode || ''}
                onValue={(v) => setAddr('registered_address', 'pincode', v)}
                disabled={disabled}
                inputMode="numeric"
                maxLength={6}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Admin office address (if different)</div>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Address line 1">
            <TextInput
              value={value.admin_office_address?.line1 || ''}
              onValue={(v) => setAddr('admin_office_address', 'line1', v)}
              disabled={disabled}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <TextInput
                value={value.admin_office_address?.city || ''}
                onValue={(v) => setAddr('admin_office_address', 'city', v)}
                disabled={disabled}
              />
            </Field>
            <Field label="State">
              <TextInput
                value={value.admin_office_address?.state || ''}
                onValue={(v) => setAddr('admin_office_address', 'state', v)}
                disabled={disabled}
              />
            </Field>
            <Field label="Pincode">
              <TextInput
                value={value.admin_office_address?.pincode || ''}
                onValue={(v) => setAddr('admin_office_address', 'pincode', v)}
                disabled={disabled}
                inputMode="numeric"
                maxLength={6}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Registration</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" required>
            <EnumSelect
              value={value.registration_type || ''}
              onChange={(v) => set({ registration_type: v })}
              options={REG_TYPES}
              disabled={disabled}
            />
          </Field>
          <Field label="Registration number" required>
            <TextInput
              value={value.registration_number || ''}
              onValue={(v) => set({ registration_number: v })}
              disabled={disabled}
            />
          </Field>
          <Field label="Registration date" required>
            <TextInput
              type="date"
              value={value.registration_date || ''}
              onValue={(v) => set({ registration_date: v })}
              disabled={disabled}
            />
          </Field>
          <Field label="PAN number" hint="e.g. AAAAA1234A" required>
            <TextInput
              value={value.pan_number || ''}
              onValue={(v) => set({ pan_number: v.toUpperCase() })}
              disabled={disabled}
              maxLength={10}
            />
          </Field>
          <Field label="PAN date" required>
            <TextInput
              type="date"
              value={value.pan_date || ''}
              onValue={(v) => set({ pan_date: v })}
              disabled={disabled}
            />
          </Field>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Chief functionary</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" required>
            <TextInput
              value={value.chief_functionary?.name || ''}
              onValue={(v) => setPerson('chief_functionary', 'name', v)}
              disabled={disabled}
            />
          </Field>
          <Field label="Phone" required>
            <TextInput
              value={value.chief_functionary?.phone || ''}
              onValue={(v) => setPerson('chief_functionary', 'phone', v)}
              disabled={disabled}
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={value.chief_functionary?.email || ''}
              onValue={(v) => setPerson('chief_functionary', 'email', v)}
              disabled={disabled}
            />
          </Field>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-medium text-stone-700 mb-2">Finance person</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" required>
            <TextInput
              value={value.finance_person?.name || ''}
              onValue={(v) => setPerson('finance_person', 'name', v)}
              disabled={disabled}
            />
          </Field>
          <Field label="Phone" required>
            <TextInput
              value={value.finance_person?.phone || ''}
              onValue={(v) => setPerson('finance_person', 'phone', v)}
              disabled={disabled}
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={value.finance_person?.email || ''}
              onValue={(v) => setPerson('finance_person', 'email', v)}
              disabled={disabled}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

'use client';

/**
 * Shared form primitives for the partner assembly wizard.
 * Same visual language as the /budget partner UI (border-stone-200, sky accents).
 */

import { forwardRef, type ReactNode } from 'react';

export const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';
export const INPUT =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full disabled:bg-stone-50 disabled:text-stone-500';
export const SELECT =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full bg-white disabled:bg-stone-50';
export const TEXTAREA =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full resize-y disabled:bg-stone-50';
export const LABEL = 'text-xs font-medium text-stone-600';
export const HINT = 'text-xs text-stone-400';
export const REMOVE_BTN = 'text-xs text-stone-400 hover:text-red-500 transition-colors';
export const ADD_BTN = 'text-sm text-sky-600 hover:text-sky-700 font-medium transition-colors';
export const TABLE_CELL = 'border-b border-stone-100 p-2 text-sm';

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <span className={HINT}>{hint}</span>}
    </div>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { onValue?: (v: string) => void }
>(function TextInput({ onValue, onChange, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type={rest.type || 'text'}
      className={`${INPUT} ${className || ''}`}
      onChange={(e) => {
        onValue?.(e.target.value);
        onChange?.(e);
      }}
      {...rest}
    />
  );
});

export function NumberInput({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      disabled={disabled}
      placeholder={placeholder}
      className={INPUT}
    />
  );
}

export function EnumSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
  placeholder = 'Select…',
}: {
  value: T | '';
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      disabled={disabled}
      className={SELECT}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SectionHeader({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {hint && <p className="text-xs text-stone-500 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export const newId = () => Math.random().toString(36).slice(2, 9);

/** FY labels re-exported from a plain server-safe module so validator/rulebook
 *  code can share them without dragging in this file's `'use client'` boundary
 *  (that mismatch caused a build-time TypeError on Vercel 2026-08-06). */
export { FY_LABELS } from '@/lib/approvals/constants';

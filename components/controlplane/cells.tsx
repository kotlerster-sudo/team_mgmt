"use client";

// Shared inline-editable cell primitives for the control-plane toolbox tables. Each cell owns a
// local draft and calls onSave when the user commits (blur for text/number, change for select/
// checkbox), showing a brief ✓ so edits feel immediate. Async errors surface a red ring + title.

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, ChevronRight } from "lucide-react";

// NOTE: no `w-full` here — that made fixed-width selects/numbers render full-width and starve the
// flex-1 text inputs. Width is set per cell: text = w-full inside a flex-1 wrapper; select/number
// default to w-full but callers override with w-40 etc.
const base = "px-2 py-1 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-stone-300";

function useSaver(onSave: (v: never) => void | Promise<void>) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const run = async (v: never) => {
    setState("saving");
    try { await onSave(v); setState("saved"); setTimeout(() => setState("idle"), 1200); }
    catch { setState("error"); }
  };
  return { state, run };
}

export function EditableText({ value, onSave, placeholder, mono, className }: { value: string; onSave: (v: string) => void | Promise<void>; placeholder?: string; mono?: boolean; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const { state, run } = useSaver(onSave as (v: never) => void);
  return (
    <div className="relative flex-1 min-w-0">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && run(v as never)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder={placeholder}
        className={`${base} w-full ${state === "error" ? "border-red-400 ring-red-200" : "border-stone-200"} ${mono ? "font-mono text-[11px]" : ""} ${className ?? ""}`}
        title={state === "error" ? "Save failed" : undefined}
      />
      {state === "saved" && <Check className="w-3.5 h-3.5 text-emerald-500 absolute right-1.5 top-1/2 -translate-y-1/2" />}
    </div>
  );
}

export function EditableNumber({ value, onSave, className }: { value: number | null; onSave: (v: number | null) => void | Promise<void>; className?: string }) {
  const [v, setV] = useState(value?.toString() ?? "");
  useEffect(() => setV(value?.toString() ?? ""), [value]);
  const { state, run } = useSaver(onSave as (v: never) => void);
  return (
    <input
      type="number"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = v.trim() === "" ? null : Number(v); if (n !== value) run(n as never); }}
      className={`${base} ${state === "error" ? "border-red-400" : "border-stone-200"} ${className ?? "w-20"}`}
      style={{ minWidth: 0 }}
    />
  );
}

export function EditableSelect({ value, options, onSave, className, allowEmpty }: { value: string | null; options: { value: string; label: string }[]; onSave: (v: string | null) => void | Promise<void>; className?: string; allowEmpty?: boolean }) {
  const { state, run } = useSaver(onSave as (v: never) => void);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => run((e.target.value || null) as never)}
      className={`${base} ${state === "error" ? "border-red-400" : "border-stone-200"} ${className ?? "w-full"}`}
    >
      {allowEmpty && <option value="">— none —</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function EditableCheckbox({ value, label, onSave }: { value: boolean; label?: string; onSave: (v: boolean) => void | Promise<void> }) {
  const { run } = useSaver(onSave as (v: never) => void);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-stone-600 cursor-pointer select-none whitespace-nowrap">
      <input type="checkbox" checked={value} onChange={(e) => run(e.target.checked as never)} className="accent-stone-700" />
      {label}
    </label>
  );
}

export function RowDelete({ onDelete, title }: { onDelete: () => void | Promise<void>; title?: string }) {
  return (
    <button onClick={onDelete} title={title ?? "Remove"} className="p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded shrink-0">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 px-2 py-1">
      <Plus className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

export function ExpandChevron({ open }: { open: boolean }) {
  return <ChevronRight className={`w-4 h-4 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`} />;
}

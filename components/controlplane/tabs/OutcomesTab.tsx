"use client";

// Journey outcome packs → outcomes. Pack fields + its outcomes array are edited inline and PUT to
// /api/admin/journey-outcome-packs/[id] (patch-style; full outcomes array replaced when it changes).

import { useCallback, useEffect, useRef, useState } from "react";
import { EditableText, EditableNumber, RowDelete, AddRow, ExpandChevron } from "@/components/controlplane/cells";

type Outcome = { key: string; label: string; unit?: string | null; captureSource?: string; bindingTemplateSlug?: string | null; bindingChecklistKey?: string | null; targetValue?: number | null; targetCadence?: string | null };
type Pack = { id: string; key: string; label: string; domain: string | null; notes: string | null; outcomes: Outcome[] };

export default function OutcomesTab() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => { const r = await fetch("/api/admin/journey-outcome-packs"); if (r.ok) setPacks(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  const save = (p: Pack, immediate = false) => {
    const body = { label: p.label, domain: p.domain, notes: p.notes, outcomes: p.outcomes };
    const doIt = () => fetch(`/api/admin/journey-outcome-packs/${p.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (immediate) { doIt(); return; }
    clearTimeout(timers.current[p.id]); timers.current[p.id] = setTimeout(doIt, 600);
  };
  const patch = (pid: string, mutate: (p: Pack) => void, immediate = false) => {
    setPacks((prev) => prev.map((p) => { if (p.id !== pid) return p; const next = structuredClone(p) as Pack; mutate(next); save(next, immediate); return next; }));
  };
  const del = async (p: Pack) => { if (!confirm(`Delete outcome pack "${p.label}"?`)) return; await fetch(`/api/admin/journey-outcome-packs/${p.id}`, { method: "DELETE" }); load(); };

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-stone-400 mb-1">Reusable outcome packs applied to programme journeys.</p>
      {packs.map((p) => (
        <div key={p.id} className="border border-stone-200 rounded-xl bg-white">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}><ExpandChevron open={!!open[p.id]} /></button>
            <EditableText value={p.label} onSave={(v) => patch(p.id, (x) => { x.label = v; })} className="font-medium" />
            <span className="text-xs text-stone-400 shrink-0">{p.domain ?? "any"} · {(p.outcomes ?? []).length} outcomes</span>
            <RowDelete onDelete={() => del(p)} />
          </div>
          {open[p.id] && (
            <div className="border-t border-stone-100 px-3 py-2 space-y-1">
              <div className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2 text-[10px] uppercase tracking-wider text-stone-400 px-1">
                <span>Label</span><span>Unit</span><span>Target</span><span></span>
              </div>
              {(p.outcomes ?? []).map((o, oi) => (
                <div key={oi} className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2 items-center">
                  <EditableText value={o.label} onSave={(v) => patch(p.id, (x) => { x.outcomes[oi].label = v; })} />
                  <EditableText value={o.unit ?? ""} onSave={(v) => patch(p.id, (x) => { x.outcomes[oi].unit = v; })} />
                  <EditableNumber value={o.targetValue ?? null} onSave={(v) => patch(p.id, (x) => { x.outcomes[oi].targetValue = v; })} className="w-16" />
                  <RowDelete onDelete={() => patch(p.id, (x) => { x.outcomes.splice(oi, 1); }, true)} />
                </div>
              ))}
              <AddRow label="outcome" onClick={() => patch(p.id, (x) => { (x.outcomes ??= []).push({ key: `outcome_${(x.outcomes?.length ?? 0) + 1}`, label: "New outcome", captureSource: "MANUAL_ADMIN" }); }, true)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

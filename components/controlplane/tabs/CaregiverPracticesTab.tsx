"use client";

import { useCallback, useEffect, useState } from "react";
import { EditableText, EditableNumber, EditableCheckbox, AddRow, ExpandChevron } from "@/components/controlplane/cells";

type Practice = { id: string; code: string; subcategory: string | null; shortLabel: string; fullText: string; trainingModule: number | null; sortOrder: number; isActive: boolean };
type Category = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; practices: Practice[] };

export default function CaregiverPracticesTab() {
  const [cats, setCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/caregiver-practices?all=1");
    if (res.ok) setCats((await res.json()).categories ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const savePractice = async (p: Practice, patch: Partial<Practice>) => {
    await fetch(`/api/admin/caregiver-practices/practices/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setCats((prev) => prev.map((c) => ({ ...c, practices: c.practices.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) })));
  };
  const saveCat = async (c: Category, patch: Partial<Category>) => {
    await fetch(`/api/admin/caregiver-practices/categories/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
  };
  const addPractice = async (c: Category) => {
    const shortLabel = prompt("New practice short label:")?.trim(); if (!shortLabel) return;
    const res = await fetch("/api/admin/caregiver-practices/practices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: c.id, shortLabel, fullText: shortLabel }) });
    if (res.ok) load(); else alert((await res.json()).error ?? "Failed");
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-stone-400 mb-1">Creche visit observation taxonomy — categories → practices.</p>
      {cats.map((c) => (
        <div key={c.id} className="border border-stone-200 rounded-xl bg-white">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}><ExpandChevron open={!!open[c.id]} /></button>
            <span className="text-[10px] font-mono text-stone-400 bg-stone-100 rounded px-1.5 py-0.5 shrink-0">{c.code}</span>
            <EditableText value={c.name} onSave={(v) => saveCat(c, { name: v })} className="font-medium" />
            <span className="text-xs text-stone-400 shrink-0">{c.practices.length}</span>
            <EditableCheckbox value={c.isActive} label="active" onSave={(v) => saveCat(c, { isActive: v })} />
          </div>
          {open[c.id] && (
            <div className="border-t border-stone-100 px-3 py-2 space-y-1.5">
              <div className="grid grid-cols-[6rem_1fr_9rem_4rem_4rem] gap-2 text-[10px] uppercase tracking-wider text-stone-400 px-1">
                <span>Code</span><span>Short label</span><span>Subcategory</span><span>Module</span><span>Active</span>
              </div>
              {c.practices.map((p) => (
                <div key={p.id} className="grid grid-cols-[6rem_1fr_9rem_4rem_4rem] gap-2 items-center">
                  <span className="text-[11px] font-mono text-stone-500 truncate" title={p.code}>{p.code}</span>
                  <EditableText value={p.shortLabel} onSave={(v) => savePractice(p, { shortLabel: v })} />
                  <EditableText value={p.subcategory ?? ""} onSave={(v) => savePractice(p, { subcategory: v })} />
                  <EditableNumber value={p.trainingModule} onSave={(v) => savePractice(p, { trainingModule: v })} className="w-14" />
                  <EditableCheckbox value={p.isActive} onSave={(v) => savePractice(p, { isActive: v })} />
                </div>
              ))}
              <AddRow label="Add practice" onClick={() => addPractice(c)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

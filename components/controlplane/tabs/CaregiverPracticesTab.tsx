"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { EditableText, EditableNumber, EditableCheckbox, AddRow, ExpandChevron } from "@/components/controlplane/cells";

type Practice = { id: string; code: string; subcategory: string | null; shortLabel: string; fullText: string; trainingModule: number | null; sortOrder: number; isActive: boolean };
type Category = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; practices: Practice[] };
type CatalogBinding = { catalogId: string; slug: string; name: string; needsDomain: string | null; bound: boolean };

export default function CaregiverPracticesTab() {
  const [cats, setCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [bindings, setBindings] = useState<CatalogBinding[]>([]);
  const [addCatalog, setAddCatalog] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/caregiver-practices?all=1");
    if (res.ok) setCats((await res.json()).categories ?? []);
  }, []);
  const loadBindings = useCallback(async () => {
    const res = await fetch("/api/admin/caregiver-practices/catalog-bindings");
    if (res.ok) setBindings(await res.json());
  }, []);
  useEffect(() => { load(); loadBindings(); }, [load, loadBindings]);

  const setBinding = async (catalogId: string, bind: boolean) => {
    await fetch("/api/admin/caregiver-practices/catalog-bindings", { method: bind ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalogId }) });
    setAddCatalog("");
    loadBindings();
  };

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

  const boundCatalogs = bindings.filter((b) => b.bound);
  const unboundCatalogs = bindings.filter((b) => !b.bound);

  return (
    <div className="space-y-4">
      {/* Caregiver Practices as a bindable subsystem — which catalogs launch it (like an indicator's bindings). */}
      <div className="border border-stone-200 rounded-xl bg-white p-3">
        <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Bound to catalogs (visit menus that open this drill)</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {boundCatalogs.map((b) => (
            <span key={b.catalogId} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-800 border border-teal-200 rounded-full pl-2.5 pr-1 py-0.5">
              {b.name}
              <button onClick={() => setBinding(b.catalogId, false)} className="p-0.5 hover:bg-teal-100 rounded-full" title="Unbind"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {boundCatalogs.length === 0 && <span className="text-xs text-stone-400 italic">Not bound to any catalog.</span>}
          {unboundCatalogs.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <select value={addCatalog} onChange={(e) => setAddCatalog(e.target.value)} className="px-2 py-1 text-xs border border-stone-200 rounded-md bg-white">
                <option value="">Bind to catalog…</option>
                {unboundCatalogs.map((b) => <option key={b.catalogId} value={b.catalogId}>{b.name}</option>)}
              </select>
              <button onClick={() => addCatalog && setBinding(addCatalog, true)} disabled={!addCatalog} className="px-2.5 py-1 text-xs bg-stone-900 text-white rounded-md disabled:opacity-40">Bind</button>
            </span>
          )}
        </div>
        <p className="text-[10px] text-stone-400 mt-1.5">Adds/removes the launcher item on the catalog. Affects new go-lives; use “Push to live centres” on the catalog to reach existing centres.</p>
      </div>

      <p className="text-xs text-stone-400">Creche visit observation taxonomy — categories → practices.</p>
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

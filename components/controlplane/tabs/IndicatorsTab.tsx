"use client";

import { useCallback, useEffect, useState } from "react";
import { EditableText, EditableSelect, EditableCheckbox, RowDelete, AddRow, ExpandChevron } from "@/components/controlplane/cells";

type Indicator = {
  id: string; key: string; label: string; description: string | null; domain: string; facilityLayerKey: string | null;
  schemeId: string | null; unit: string | null; frequency: string; color: string; targetFormula: unknown;
  captureSource: string; misProviderId: string | null; misFetchConfig: unknown; staleYellowDays: number; staleRedDays: number; sortOrder: number; isActive: boolean;
};
type Opt = { value: string; label: string };

export default function IndicatorsTab() {
  const [inds, setInds] = useState<Indicator[]>([]);
  const [domains, setDomains] = useState<Opt[]>([]);
  const [layers, setLayers] = useState<Opt[]>([]);
  const [sources, setSources] = useState<Opt[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/facility-indicators?all=1");
    if (res.ok) setInds(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/needs/formulas").then((r) => r.json()).then((r: { domain: string; label: string }[]) => setDomains((r ?? []).map((d) => ({ value: d.domain, label: d.label })))).catch(() => {});
    fetch("/api/admin/facility-layers").then((r) => r.json()).then((r: { layerKey: string; label: string }[]) => setLayers((r ?? []).map((l) => ({ value: l.layerKey, label: l.label })))).catch(() => {});
    fetch("/api/enum-labels?enumKey=FacilityIndicatorSource").then((r) => r.json()).then((r: { code: string; label: string }[]) => setSources((r ?? []).map((s) => ({ value: s.code, label: s.label })))).catch(() => {});
  }, []);

  const save = async (ind: Indicator, patch: Partial<Indicator>) => {
    const next = { ...ind, ...patch };
    await fetch(`/api/admin/facility-indicators/${ind.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setInds((prev) => prev.map((x) => (x.id === ind.id ? next : x)));
  };
  const del = async (ind: Indicator) => { if (!confirm(`Deactivate indicator "${ind.label}"?`)) return; await fetch(`/api/admin/facility-indicators/${ind.id}`, { method: "DELETE" }); load(); };
  const add = async () => {
    const label = prompt("New indicator label:")?.trim(); if (!label) return;
    const key = prompt("Key (e.g. creche_new_metric):")?.trim(); if (!key) return;
    const res = await fetch("/api/admin/facility-indicators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, label, domain: domains[0]?.value ?? "Creche", captureSource: "RP_ACTIVITY", sortOrder: inds.length }) });
    if (res.ok) load(); else alert((await res.json()).error ?? "Failed");
  };

  return (
    <div>
      <div className="grid grid-cols-[1.5rem_1fr_11rem_9rem_9rem_4rem_9rem_4rem_2rem] gap-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-1 pb-1">
        <span></span><span>Label</span><span>Key</span><span>Domain</span><span>Layer</span><span>Unit</span><span>Source</span><span>Active</span><span></span>
      </div>
      <div className="space-y-1">
        {inds.map((ind) => (
          <div key={ind.id} className="border border-stone-100 rounded-lg">
            <div className="grid grid-cols-[1.5rem_1fr_11rem_9rem_9rem_4rem_9rem_4rem_2rem] gap-2 items-center px-1 py-1">
              <button onClick={() => setOpen((o) => ({ ...o, [ind.id]: !o[ind.id] }))}><ExpandChevron open={!!open[ind.id]} /></button>
              <EditableText value={ind.label} onSave={(v) => save(ind, { label: v })} />
              <span className="text-[11px] font-mono text-stone-500 truncate" title={ind.key}>{ind.key}</span>
              <EditableSelect value={ind.domain} options={domains} onSave={(v) => save(ind, { domain: v ?? ind.domain })} />
              <EditableSelect value={ind.facilityLayerKey} options={layers} allowEmpty onSave={(v) => save(ind, { facilityLayerKey: v })} />
              <EditableText value={ind.unit ?? ""} onSave={(v) => save(ind, { unit: v })} />
              <EditableSelect value={ind.captureSource} options={sources} onSave={(v) => save(ind, { captureSource: v ?? ind.captureSource })} />
              <EditableCheckbox value={ind.isActive} onSave={(v) => save(ind, { isActive: v })} />
              <RowDelete onDelete={() => del(ind)} title="Deactivate" />
            </div>
            {open[ind.id] && <IndicatorDrill indicatorId={ind.id} />}
          </div>
        ))}
      </div>
      <div className="mt-2"><AddRow label="Add indicator" onClick={add} /></div>
    </div>
  );
}

// ── Drill-in: 24-point scored checklist items + RP_ACTIVITY bindings ──────────
type CkItem = { id: string; itemKey: string; text: string; category: string | null; nonNegotiable: boolean; naAllowed: boolean; sortOrder: number; isActive: boolean };
type Binding = { id: string; templateSlug: string; checklistKey: string; templateName: string | null };

function IndicatorDrill({ indicatorId }: { indicatorId: string }) {
  const [items, setItems] = useState<CkItem[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [keyOpts, setKeyOpts] = useState<{ value: string; label: string }[]>([]);
  const [addKey, setAddKey] = useState("");

  const load = useCallback(async () => {
    const [it, bi] = await Promise.all([
      fetch(`/api/admin/facility-indicators/${indicatorId}/checklist-items`).then((r) => r.json()).catch(() => []),
      fetch(`/api/admin/facility-indicators/${indicatorId}/bindings`).then((r) => r.json()).catch(() => []),
    ]);
    setItems((it ?? []).filter((x: CkItem) => x.isActive));
    setBindings(bi ?? []);
  }, [indicatorId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/template-checklist-keys").then((r) => r.json()).then((tpls: { slug: string; name: string; items: { key: string; text: string }[] }[]) => {
      setKeyOpts((tpls ?? []).flatMap((t) => t.items.map((i) => ({ value: `${t.slug}::${i.key}`, label: `${t.name}: ${i.text}` }))));
    }).catch(() => {});
  }, []);

  const saveItem = async (i: CkItem, patch: Partial<CkItem>) => {
    await fetch(`/api/admin/facility-indicators/${indicatorId}/checklist-items/${i.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, ...patch } : x)));
  };
  const delItem = async (i: CkItem) => { await fetch(`/api/admin/facility-indicators/${indicatorId}/checklist-items/${i.id}`, { method: "DELETE" }); load(); };
  const addItem = async () => {
    const text = prompt("New scored-checklist item text:")?.trim(); if (!text) return;
    await fetch(`/api/admin/facility-indicators/${indicatorId}/checklist-items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sortOrder: items.length }) });
    load();
  };
  const addBinding = async () => {
    if (!addKey) return;
    const [templateSlug, checklistKey] = addKey.split("::");
    const res = await fetch(`/api/admin/facility-indicators/${indicatorId}/bindings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateSlug, checklistKey }) });
    if (res.ok) { setAddKey(""); load(); } else alert((await res.json()).error ?? "Failed");
  };
  const delBinding = async (b: Binding) => { await fetch("/api/admin/control-plane/binding", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bindingId: b.id }) }); load(); };

  return (
    <div className="border-t border-stone-100 bg-stone-50/60 px-3 py-2.5 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-1">Scored checklist ({items.length})</div>
        <div className="space-y-1">
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-2">
              <EditableText value={i.text} onSave={(v) => saveItem(i, { text: v })} />
              <EditableText value={i.category ?? ""} onSave={(v) => saveItem(i, { category: v })} placeholder="category" className="!w-28" />
              <EditableCheckbox value={i.nonNegotiable} label="non-neg" onSave={(v) => saveItem(i, { nonNegotiable: v })} />
              <RowDelete onDelete={() => delItem(i)} />
            </div>
          ))}
        </div>
        <AddRow label="Add item" onClick={addItem} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-1">RP-activity bindings ({bindings.length})</div>
        <div className="space-y-1">
          {bindings.map((b) => (
            <div key={b.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate text-stone-700">{b.templateName ? `${b.templateName}: ` : ""}{b.checklistKey}</span>
              <RowDelete onDelete={() => delBinding(b)} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <select value={addKey} onChange={(e) => setAddKey(e.target.value)} className="flex-1 px-2 py-1 text-xs border border-stone-200 rounded-md bg-white">
            <option value="">Bind a checklist item…</option>
            {keyOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={addBinding} disabled={!addKey} className="px-2.5 py-1 text-xs bg-stone-900 text-white rounded-md disabled:opacity-40">Bind</button>
        </div>
      </div>
    </div>
  );
}

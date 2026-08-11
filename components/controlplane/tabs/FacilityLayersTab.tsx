"use client";

import { useCallback, useEffect, useState } from "react";
import { EditableText, EditableNumber, EditableSelect, RowDelete, AddRow } from "@/components/controlplane/cells";

type Layer = { id: string; layerKey: string; label: string; color: string; needsDomain: string | null; centreTypes: string[]; sortOrder: number };

export default function FacilityLayersTab() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [domains, setDomains] = useState<{ value: string; label: string }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/facility-layers");
    if (res.ok) setLayers(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/needs/formulas").then((r) => r.json()).then((rows: { domain: string; label: string }[]) => setDomains((rows ?? []).map((d) => ({ value: d.domain, label: d.label })))).catch(() => {});
  }, []);

  const save = async (l: Layer, patch: Partial<Layer>) => {
    const next = { ...l, ...patch };
    await fetch(`/api/admin/facility-layers/${l.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layerKey: next.layerKey, label: next.label, color: next.color, needsDomain: next.needsDomain, sortOrder: next.sortOrder, centreTypes: next.centreTypes }),
    });
    setLayers((prev) => prev.map((x) => (x.id === l.id ? next : x)));
  };
  const del = async (l: Layer) => { if (!confirm(`Remove layer "${l.label}"?`)) return; await fetch(`/api/admin/facility-layers/${l.id}`, { method: "DELETE" }); load(); };
  const add = async () => {
    const layerKey = prompt("New layer key (e.g. elderly_kitchens):")?.trim(); if (!layerKey) return;
    const res = await fetch("/api/admin/facility-layers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layerKey, label: layerKey, color: "#6366f1", sortOrder: layers.length, centreTypes: [] }) });
    if (res.ok) load(); else alert((await res.json()).error ?? "Failed");
  };

  return (
    <div>
      <div className="grid grid-cols-[8rem_1fr_2.5rem_9rem_1fr_4rem_2rem] gap-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-1 pb-1">
        <span>Key</span><span>Label</span><span>Colour</span><span>Domain</span><span>Centre types (comma)</span><span>Order</span><span></span>
      </div>
      <div className="space-y-1.5">
        {layers.map((l) => (
          <div key={l.id} className="grid grid-cols-[8rem_1fr_2.5rem_9rem_1fr_4rem_2rem] gap-2 items-center">
            <span className="text-[11px] font-mono text-stone-500 truncate" title={l.layerKey}>{l.layerKey}</span>
            <EditableText value={l.label} onSave={(v) => save(l, { label: v })} />
            <input type="color" value={l.color} onChange={(e) => save(l, { color: e.target.value })} className="w-8 h-7 rounded border border-stone-200 p-0.5" />
            <EditableSelect value={l.needsDomain} options={domains} allowEmpty onSave={(v) => save(l, { needsDomain: v })} />
            <EditableText value={(l.centreTypes ?? []).join(", ")} onSave={(v) => save(l, { centreTypes: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <EditableNumber value={l.sortOrder} onSave={(v) => save(l, { sortOrder: v ?? 0 })} className="w-16" />
            <RowDelete onDelete={() => del(l)} />
          </div>
        ))}
      </div>
      <div className="mt-2"><AddRow label="Add facility layer" onClick={add} /></div>
    </div>
  );
}

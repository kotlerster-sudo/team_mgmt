"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPin, Users, X, Search } from "lucide-react";

type Cluster = { id: string; name: string };
type Rp = { id: string; name: string; designation: string; clusterIds: string[] };
type Intervention = { id: string; title: string; domain: string; unit: string; clusterId: string | null; clusterName: string | null; settlementId: string | null; settlementName: string | null; facilityId: string | null; facilityName: string | null };
type Data = { clusters: Cluster[]; rps: Rp[]; interventions: Intervention[] };

export function AssignmentsEditor({ data, layerKeyByDomain }: { data: Data; layerKeyByDomain: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [expandedRp, setExpandedRp] = useState<string | null>(null);
  const [editGeo, setEditGeo] = useState<Intervention | null>(null);
  const [q, setQ] = useState("");

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed");
      router.refresh();
      return res.json().catch(() => ({}));
    } catch (e) { alert(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }

  const filtered = data.interventions.filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase()) || (i.clusterName ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-4xl mx-auto px-5 py-6 space-y-8">
      <div>
        <Link href="/field/backend" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"><ChevronLeft size={16} /> Backend</Link>
        <h1 className="mt-2 flex items-center gap-2 text-lg font-semibold text-stone-900"><MapPin size={18} className="text-stone-400" /> Geography &amp; assignment</h1>
      </div>

      {/* RP → clusters */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-stone-700"><Users size={15} /> RP cluster assignments</h2>
        <p className="text-xs text-stone-400">Which clusters each field person sees on /field.</p>
        <ul className="space-y-1.5">
          {data.rps.map((rp) => (
            <li key={rp.id} className="rounded-xl border border-stone-200 bg-white">
              <button onClick={() => setExpandedRp(expandedRp === rp.id ? null : rp.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
                <span className="text-sm font-medium text-stone-800">{rp.name} <span className="text-xs font-normal text-stone-400">{rp.designation}</span></span>
                <span className="text-xs text-stone-500">{rp.clusterIds.length} cluster{rp.clusterIds.length === 1 ? "" : "s"}</span>
              </button>
              {expandedRp === rp.id && (
                <div className="border-t border-stone-100 p-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                    {data.clusters.map((c) => {
                      const on = rp.clusterIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-1.5 text-sm text-stone-600">
                          <input type="checkbox" checked={on} disabled={busy} onChange={(e) => {
                            const next = e.target.checked ? [...rp.clusterIds, c.id] : rp.clusterIds.filter((x) => x !== c.id);
                            call(`/api/field/admin/assign-rp`, "POST", { userId: rp.id, clusterIds: next });
                          }} />
                          <span className="truncate">{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Intervention geography */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-stone-700"><MapPin size={15} /> Intervention geography</h2>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-stone-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search interventions…" className="w-full rounded-lg border border-stone-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-stone-400" />
        </div>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {filtered.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-stone-800">{i.title}</p>
                <p className="text-xs text-stone-500">{i.clusterName ?? "—"}{i.settlementName ? ` · ${i.settlementName}` : ""}{i.facilityName ? ` · ${i.facilityName}` : ""}</p>
              </div>
              <button onClick={() => setEditGeo(i)} className="flex-shrink-0 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50">Edit</button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-stone-400">No matches.</li>}
        </ul>
      </section>

      {editGeo && (
        <GeoEditModal intervention={editGeo} clusters={data.clusters} layerKey={layerKeyByDomain[editGeo.domain]} busy={busy}
          onClose={() => setEditGeo(null)}
          onSave={async (body) => { await call(`/api/field/admin/intervention/${editGeo.id}`, "PATCH", body); setEditGeo(null); }} />
      )}
    </div>
  );
}

function GeoEditModal({ intervention, clusters, layerKey, busy, onClose, onSave }: { intervention: Intervention; clusters: Cluster[]; layerKey?: string; busy: boolean; onClose: () => void; onSave: (body: unknown) => void }) {
  const needsSettlement = intervention.unit === "settlement";
  const [clusterId, setClusterId] = useState(intervention.clusterId ?? "");
  const [settlementId, setSettlementId] = useState(intervention.settlementId ?? "");
  const [facilityId, setFacilityId] = useState(intervention.facilityId ?? "");
  const [geo, setGeo] = useState<{ settlements: { id: string; name: string }[]; facilities: { id: string; name: string }[] }>({ settlements: [], facilities: [] });

  const loadGeo = async (cid: string) => {
    if (!cid) return setGeo({ settlements: [], facilities: [] });
    const r = await fetch(`/api/field/admin/geo?clusterId=${cid}${layerKey ? `&layerKey=${layerKey}` : ""}`).then((x) => x.json()).catch(() => ({ settlements: [], facilities: [] }));
    setGeo({ settlements: r.settlements ?? [], facilities: r.facilities ?? [] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between"><h3 className="text-base font-semibold text-stone-900">{intervention.title}</h3><button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={20} /></button></div>
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">Cluster</span>
            <select value={clusterId} onChange={(e) => { setClusterId(e.target.value); setSettlementId(""); setFacilityId(""); loadGeo(e.target.value); }} className="inp"><option value="">—</option>{clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          {needsSettlement && (
            <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">Settlement</span>
              <select value={settlementId} onChange={(e) => setSettlementId(e.target.value)} className="inp"><option value="">{intervention.settlementName ?? "— (load a cluster)"}</option>{geo.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          {layerKey && (
            <label className="block"><span className="mb-1 flex items-center justify-between text-xs font-medium text-stone-500">Facility (optional)
              <button type="button" disabled={!clusterId} onClick={async () => {
                const name = prompt("New facility name:")?.trim();
                if (!name) return;
                const r = await fetch(`/api/field/admin/facility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, layerKey, clusterId, settlementId: settlementId || null }) }).then((x) => x.json()).catch(() => null);
                if (r?.ok) { setGeo((g) => ({ ...g, facilities: [...g.facilities, r.facility] })); setFacilityId(r.facility.id); } else alert(r?.error ?? "Failed");
              }} className="font-normal text-stone-500 underline disabled:opacity-40 disabled:no-underline">+ new</button>
            </span>
              <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="inp"><option value="">{intervention.facilityName ?? "—"}</option>{geo.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
          <button disabled={busy} onClick={() => onSave({ clusterId: clusterId || null, settlementId: needsSettlement ? (settlementId || null) : undefined, facilityId: facilityId || null })} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">Save</button>
        </div>
        <style>{`.inp{height:2.25rem;width:100%;border:1px solid rgb(231 229 228);border-radius:0.5rem;padding:0 0.6rem;font-size:0.875rem;outline:none}.inp:focus{border-color:rgb(168 162 158)}`}</style>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Pencil, Trash2, Check, X, MapPin, SquarePen, ClipboardList, Download } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

// Partners come from /api/map/partners (Org rows where kind="partner") —
// no hardcoded LAYERS-derived list. After the Org migration (2026-06-04)
// every partner is an admin-edited row.

// Known centre types per layer key — used as suggestions; falls back to text input for unknown keys
const CENTRE_TYPES: Record<string, string[]> = {
  creches:           ["Creche"],
  children_centres:  ["Children Centre"],
  youth_centres:     ["Youth Centre"],
  resource_centres:  ["Resource Centre", "Community Resource Centre"],
};

// ── Types ──────────────────────────────────────────────────────────────────

interface GeoRef { id: string; name: string }

interface LayerKey { key: string; label: string; centreTypes?: string[] }

interface LayerFeatureRow {
  id: string;
  name: string;
  layerKey: string;
  centreType: string | null;
  partner: string | null;
  lat: number;
  lng: number;
  settlementId: string | null;
  clusterId: string | null;
  zoneId: string | null;
  notes: string | null;
  settlement: GeoRef | null;
  cluster: GeoRef | null;
  zone: GeoRef | null;
}

interface SettlementRow {
  id: string;
  name: string;
  polygon: unknown;
  centroidLat: number | null;
  centroidLng: number | null;
  partnerId: string | null;
  clusterId: string;
  cluster: { id: string; name: string; zone: { id: string; name: string } };
  partner: { id: string; key: string; label: string; color: string } | null;
}

interface ClusterOption { id: string; name: string; zoneId: string }
interface ZoneOption    { id: string; name: string }
interface PartnerOption { id: string; key: string; label: string; color: string }

// ── Toast ──────────────────────────────────────────────────────────────────

function useToast() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const show = useCallback((text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }, []);
  return { msg, show };
}

function Toast({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full shadow-lg text-sm font-medium text-white ${msg.ok ? "bg-emerald-600" : "bg-red-500"}`}>
      {msg.text}
    </div>
  );
}

// ── Empty form factories ────────────────────────────────────────────────────

function emptyLF(layerKey = "creches"): Omit<LayerFeatureRow, "id" | "settlement" | "cluster" | "zone"> {
  return { name: "", layerKey, centreType: CENTRE_TYPES[layerKey]?.[0] ?? "", partner: "", lat: 0, lng: 0, settlementId: "", clusterId: "", zoneId: "", notes: "" };
}

function emptySett(): Partial<SettlementRow> & { name: string; clusterId: string } {
  return { name: "", clusterId: "", partnerId: "", polygon: null, centroidLat: undefined, centroidLng: undefined };
}

// ── LayerFeature form ───────────────────────────────────────────────────────

function LFForm({
  initial,
  layerKeys,
  clusters,
  zones,
  partners,
  settlements,
  onSave,
  onCancel,
}: {
  initial: Omit<LayerFeatureRow, "id" | "settlement" | "cluster" | "zone">;
  layerKeys: LayerKey[];
  clusters: ClusterOption[];
  zones: ZoneOption[];
  partners: PartnerOption[];
  settlements: { id: string; name: string; clusterId: string }[];
  onSave: (data: typeof initial) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  // Partner list comes straight from the DB now.
  const allPartners = partners;

  // Centre-type suggestions come from the layer config (de-hardcoded), with a fallback default.
  const ctByLayer: Record<string, string[]> = Object.fromEntries(layerKeys.map((l) => [l.key, (l.centreTypes && l.centreTypes.length ? l.centreTypes : CENTRE_TYPES[l.key]) ?? []]));

  // Zone → filter clusters; cluster → infer zone
  const visibleClusters = form.zoneId
    ? clusters.filter(c => c.zoneId === form.zoneId)
    : clusters;

  // Settlement → cascade: filter by cluster then zone
  const visibleSettlements = form.clusterId
    ? settlements.filter(s => s.clusterId === form.clusterId)
    : form.zoneId
      ? settlements.filter(s => {
          const cl = clusters.find(c => c.id === s.clusterId);
          return cl?.zoneId === form.zoneId;
        })
      : settlements;

  const knownCentreTypes = ctByLayer[form.layerKey] ?? [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
      <div>
        <label className="label">Name *</label>
        <input className="input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Centre name" autoFocus />
      </div>
      <div>
        <label className="label">Layer type *</label>
        <select className="input" value={form.layerKey} onChange={e => {
          const lk = e.target.value;
          setForm(f => ({ ...f, layerKey: lk, centreType: ctByLayer[lk]?.[0] ?? "" }));
        }}>
          {layerKeys.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Centre type</label>
        {knownCentreTypes.length > 0 ? (
          <select className="input" value={form.centreType ?? ""} onChange={e => set("centreType", e.target.value)}>
            {knownCentreTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <input className="input" value={form.centreType ?? ""} onChange={e => set("centreType", e.target.value)} placeholder="e.g. Community Hub" />
        )}
      </div>
      <div>
        <label className="label">Partner</label>
        <select className="input" value={form.partner ?? ""} onChange={e => set("partner", e.target.value)}>
          <option value="">— None —</option>
          {allPartners.map(p => <option key={p.id} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Latitude *</label>
        <input className="input" type="number" step="any" value={form.lat} onChange={e => set("lat", e.target.value)} />
      </div>
      <div>
        <label className="label">Longitude *</label>
        <input className="input" type="number" step="any" value={form.lng} onChange={e => set("lng", e.target.value)} />
      </div>

      {/* Zone → Cluster → Settlement cascade */}
      <div>
        <label className="label">Zone (filters clusters &amp; settlements)</label>
        <select className="input" value={form.zoneId ?? ""} onChange={e => {
          setForm(f => ({ ...f, zoneId: e.target.value, clusterId: "", settlementId: "" }));
        }}>
          <option value="">— All zones —</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Cluster</label>
        <select className="input" value={form.clusterId ?? ""} onChange={e => {
          const cid = e.target.value;
          const cl = clusters.find(c => c.id === cid);
          setForm(f => ({ ...f, clusterId: cid, zoneId: cl?.zoneId ?? f.zoneId, settlementId: "" }));
        }}>
          <option value="">— None —</option>
          {visibleClusters.map(c => <option key={c.id} value={c.id}>{c.name.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">
          Settlement{form.zoneId || form.clusterId ? " (filtered by zone/cluster above)" : ""}
        </label>
        <select className="input" value={form.settlementId ?? ""} onChange={e => {
          const sid = e.target.value;
          const s = settlements.find(s => s.id === sid);
          const cl = s ? clusters.find(c => c.id === s.clusterId) : undefined;
          setForm(f => ({ ...f, settlementId: sid, clusterId: s?.clusterId ?? f.clusterId, zoneId: cl?.zoneId ?? f.zoneId }));
        }}>
          <option value="">— None —</option>
          {visibleSettlements.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {(form.zoneId || form.clusterId) && visibleSettlements.length === 0 && (
          <p className="text-[11px] text-slate-400 mt-0.5">No settlements in this zone/cluster yet.</p>
        )}
      </div>
      <div className="sm:col-span-2">
        <label className="label">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} />
      </div>
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || !form.layerKey}
          className="btn-primary"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}

// ── Settlement form ─────────────────────────────────────────────────────────

function SettForm({
  initial,
  clusters,
  zones,
  partners,
  onSave,
  onCancel,
}: {
  initial: { name: string; clusterId: string; partnerId?: string | null; polygon?: unknown; centroidLat?: number | null; centroidLng?: number | null };
  clusters: ClusterOption[];
  zones: ZoneOption[];
  partners: PartnerOption[];
  onSave: (data: typeof initial) => void;
  onCancel: () => void;
}) {
  // Pre-populate zone from existing cluster when editing
  const initialZoneId = initial.clusterId
    ? clusters.find(c => c.id === initial.clusterId)?.zoneId ?? ""
    : "";

  const [form, setForm] = useState({
    ...initial,
    zoneId: initialZoneId,
    polygonText: initial.polygon ? JSON.stringify(initial.polygon, null, 2) : "",
  });
  const [polyErr, setPolyErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  function parsePolygon() {
    if (!form.polygonText.trim()) return null;
    try {
      const parsed = JSON.parse(form.polygonText);
      setPolyErr(null);
      return parsed;
    } catch {
      setPolyErr("Invalid JSON");
      return undefined;
    }
  }

  function handleSave() {
    const poly = parsePolygon();
    if (poly === undefined) return;
    onSave({ name: form.name, clusterId: form.clusterId, partnerId: form.partnerId, polygon: poly, centroidLat: form.centroidLat, centroidLng: form.centroidLng });
  }

  // Zone → filter clusters
  const visibleClusters = form.zoneId
    ? clusters.filter(c => c.zoneId === form.zoneId)
    : clusters;

  // Infer zone from selected cluster (shown read-only if zone wasn't explicitly set)
  const selectedCluster = clusters.find(c => c.id === form.clusterId);
  const inferredZone = !form.zoneId && selectedCluster
    ? zones.find(z => z.id === selectedCluster.zoneId)
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
      <div>
        <label className="label">Name *</label>
        <input className="input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Settlement name" autoFocus />
      </div>
      <div>
        <label className="label">Zone (filters clusters below)</label>
        <select className="input" value={form.zoneId} onChange={e => setForm(f => ({ ...f, zoneId: e.target.value, clusterId: "" }))}>
          <option value="">— All zones —</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Cluster *</label>
        <select className="input" value={form.clusterId} onChange={e => {
          const cid = e.target.value;
          const cl = clusters.find(c => c.id === cid);
          // If no zone was manually chosen, auto-set it from the cluster
          setForm(f => ({ ...f, clusterId: cid, zoneId: f.zoneId || cl?.zoneId || "" }));
        }}>
          <option value="">— Select cluster —</option>
          {visibleClusters.map(c => <option key={c.id} value={c.id}>{c.name.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      {inferredZone && (
        <div>
          <label className="label">Zone (from cluster)</label>
          <div className="input bg-slate-50 text-slate-500">{inferredZone.name}</div>
        </div>
      )}
      <div>
        <label className="label">Partner NGO</label>
        <select className="input" value={form.partnerId ?? ""} onChange={e => set("partnerId", e.target.value)}>
          <option value="">— None —</option>
          {partners.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Centroid lat</label>
        <input className="input" type="number" step="any" value={form.centroidLat ?? ""} onChange={e => set("centroidLat", e.target.value ? parseFloat(e.target.value) : null)} />
      </div>
      <div>
        <label className="label">Centroid lng</label>
        <input className="input" type="number" step="any" value={form.centroidLng ?? ""} onChange={e => set("centroidLng", e.target.value ? parseFloat(e.target.value) : null)} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Polygon GeoJSON geometry</label>
        <textarea
          className={`input font-mono text-xs resize-none ${polyErr ? "border-red-400" : ""}`}
          rows={6}
          value={form.polygonText}
          onChange={e => { set("polygonText", e.target.value); setPolyErr(null); }}
          placeholder={`{"type":"Polygon","coordinates":[[[lng,lat],…]]}`}
        />
        {polyErr && <p className="text-xs text-red-500 mt-0.5">{polyErr}</p>}
        <p className="text-[10px] text-slate-400 mt-0.5">Paste GeoJSON geometry object (Polygon or MultiPolygon). Leave blank to clear.</p>
      </div>
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim() || !form.clusterId}
          className="btn-primary"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}

// ── Settlement export download (fetch+blob; survives mobile PWA + service workers) ──

async function downloadExport(format: "geojson" | "xlsx", show: (text: string, ok?: boolean) => void) {
  try {
    const res = await fetch(`/api/admin/settlements/export?format=${format}`);
    if (!res.ok) { show(`Export failed (${res.status})`, false); return; }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="?([^";]+)"?/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = m?.[1] ?? `settlements.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    show("Export failed. Please try again.", false);
  }
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function MapFeaturesSettingsPage() {
  const [tab, setTab] = useState<"points" | "settlements">("points");
  const [layerKeys, setLayerKeys] = useState<LayerKey[]>([
    { key: "creches", label: "Creches" },
    { key: "children_centres", label: "Children Centres" },
    { key: "youth_centres", label: "Youth Centres" },
    { key: "resource_centres", label: "Resource Centres" },
  ]);
  const [lkFilter, setLkFilter] = useState("creches");

  const [features, setFeatures] = useState<LayerFeatureRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [clusters, setClusters] = useState<ClusterOption[]>([]);
  const [zones, setZones]         = useState<ZoneOption[]>([]);
  const [partners, setPartners]   = useState<PartnerOption[]>([]);

  const [addingLF, setAddingLF]     = useState(false);
  const [editingLF, setEditingLF]   = useState<LayerFeatureRow | null>(null);
  const [addingSett, setAddingSett] = useState(false);
  const [editingSett, setEditingSett] = useState<SettlementRow | null>(null);
  const [loading, setLoading]       = useState(true);

  const { msg, show } = useToast();

  // Settlement name search for LF form
  const [settSearch, setSettSearch] = useState("");
  const filteredSettlements = settlements
    .filter(s => !settSearch || s.name.toLowerCase().includes(settSearch.toLowerCase()))
    .map(s => ({ id: s.id, name: s.name, clusterId: s.clusterId }));

  // Fetch facility layer types from DB (replaces hardcoded LAYER_KEYS)
  useEffect(() => {
    fetch("/api/admin/facility-layers")
      .then(r => r.json())
      .then((rows: { layerKey: string; label: string; centreTypes?: string[] }[]) => {
        if (rows.length > 0) {
          const lks = rows.map(r => ({ key: r.layerKey, label: r.label, centreTypes: r.centreTypes ?? [] }));
          setLayerKeys(lks);
          // Keep lkFilter valid; reset to first key if current filter no longer exists
          setLkFilter(f => lks.some(l => l.key === f) ? f : (lks[0]?.key ?? f));
        }
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [lf, sett, geo, part] = await Promise.all([
      fetch(`/api/admin/layer-features?layerKey=${lkFilter}`).then(r => r.json()),
      fetch("/api/admin/settlements").then(r => r.json()),
      fetch("/api/geo").then(r => r.json()),
      fetch("/api/map/partners").then(r => r.json()),
    ]);
    setFeatures(lf);
    setSettlements(sett);
    setClusters(geo.clusters ?? []);
    setZones(geo.zones ?? []);
    setPartners(part);
    setLoading(false);
  }, [lkFilter]);

  useEffect(() => { load(); }, [load]);

  // ── LayerFeature handlers ─────────────────────────────────────────────────

  async function createLF(data: Omit<LayerFeatureRow, "id" | "settlement" | "cluster" | "zone">) {
    const r = await fetch("/api/admin/layer-features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (r.ok) { show("Point added"); setAddingLF(false); load(); }
    else show("Failed to save", false);
  }

  async function updateLF(id: string, data: Partial<LayerFeatureRow>) {
    const r = await fetch(`/api/admin/layer-features/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (r.ok) { show("Saved"); setEditingLF(null); load(); }
    else show("Failed to save", false);
  }

  async function deleteLF(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const r = await fetch(`/api/admin/layer-features/${id}`, { method: "DELETE" });
    if (r.ok) { show("Deleted"); load(); }
    else show("Failed to delete", false);
  }

  // ── Settlement handlers ───────────────────────────────────────────────────

  async function createSett(data: { name: string; clusterId: string; partnerId?: string | null; polygon?: unknown; centroidLat?: number | null; centroidLng?: number | null }) {
    const r = await fetch("/api/admin/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (r.ok) { show("Settlement created"); setAddingSett(false); load(); }
    else show("Failed to save", false);
  }

  async function updateSett(id: string, data: { name?: string; clusterId?: string; partnerId?: string | null; polygon?: unknown; centroidLat?: number | null; centroidLng?: number | null }) {
    const r = await fetch(`/api/admin/settlements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (r.ok) { show("Saved"); setEditingSett(null); load(); }
    else show("Failed to save", false);
  }

  async function deleteSett(id: string, name: string) {
    if (!confirm(`Delete settlement "${name}"? This will soft-delete it.`)) return;
    const r = await fetch(`/api/admin/settlements/${id}`, { method: "DELETE" });
    if (r.ok) { show("Deleted"); load(); }
    else show("Failed to delete", false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SurfaceProvider id="settings.map_features">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <style>{`
        .label { display:block; font-size:11px; font-weight:600; color:#64748b; margin-bottom:3px }
        .input { display:block; width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; font-size:13px; background:white; outline:none }
        .input:focus { box-shadow:0 0 0 2px #a5b4fc }
        .btn-primary { display:inline-flex; align-items:center; gap:4px; padding:6px 14px; background:#4f46e5; color:white; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer }
        .btn-primary:disabled { opacity:0.5; cursor:not-allowed }
        .btn-ghost { display:inline-flex; align-items:center; gap:4px; padding:6px 14px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; font-weight:500; color:#64748b; cursor:pointer }
        .btn-ghost:hover { background:#f8fafc }
      `}</style>

      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-slate-400 hover:text-slate-700 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Map Features</h1>
          <p className="text-xs text-slate-500">
            Manage programme centre points and settlement polygons.{" "}
            <Link href="/settings/facility-layers" className="text-indigo-500 hover:underline">Add/edit layer types →</Link>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["points", "settlements"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "points" ? "Centre Points" : "Settlements"}
          </button>
        ))}
      </div>

      {/* ── POINTS TAB ───────────────────────────────────────────────────────── */}
      {tab === "points" && (
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex gap-1 flex-wrap">
              {layerKeys.map(lk => (
                <button
                  key={lk.key}
                  onClick={() => { setLkFilter(lk.key); setAddingLF(false); setEditingLF(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    lkFilter === lk.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {lk.label} {!loading && lkFilter === lk.key ? `(${features.length})` : ""}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setAddingLF(true); setEditingLF(null); }}
              disabled={addingLF}
              className="ml-auto btn-primary"
            >
              <Plus className="w-3.5 h-3.5" /> Add point
            </button>
          </div>

          {addingLF && (
            <div className="mb-4">
              <LFForm
                initial={emptyLF(lkFilter)}
                layerKeys={layerKeys}
                clusters={clusters}
                zones={zones}
                partners={partners}
                settlements={filteredSettlements}
                onSave={createLF}
                onCancel={() => setAddingLF(false)}
              />
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
          ) : features.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No points for this layer yet.</div>
          ) : (
            <div className="space-y-2">
              {features.map(f => (
                <div key={f.id}>
                  {editingLF?.id === f.id ? (
                    <LFForm
                      initial={{ name: f.name, layerKey: f.layerKey, centreType: f.centreType, partner: f.partner, lat: f.lat, lng: f.lng, settlementId: f.settlementId, clusterId: f.clusterId, zoneId: f.zoneId, notes: f.notes }}
                      layerKeys={layerKeys}
                      clusters={clusters}
                      zones={zones}
                      partners={partners}
                      settlements={filteredSettlements}
                      onSave={(data) => updateLF(f.id, data)}
                      onCancel={() => setEditingLF(null)}
                    />
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                      <MapPin className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{f.name}</span>
                          {f.centreType && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{f.centreType}</span>}
                          {f.partner && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{f.partner}</span>}
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-400">
                          {f.settlement && <span>Settlement: <span className="text-slate-600">{f.settlement.name}</span></span>}
                          {f.cluster    && <span>Cluster: <span className="text-slate-600">{f.cluster.name.replace(/_/g, " ")}</span></span>}
                          {f.zone       && <span>Zone: <span className="text-slate-600">{f.zone.name}</span></span>}
                          <span className="font-mono">{f.lat.toFixed(4)}, {f.lng.toFixed(4)}</span>
                          {f.notes      && <span className="italic">&ldquo;{f.notes}&rdquo;</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => { setEditingLF(f); setAddingLF(false); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteLF(f.id, f.name)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTLEMENTS TAB ──────────────────────────────────────────────────── */}
      {tab === "settlements" && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p className="text-sm text-slate-500">{settlements.length} settlements total</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                onClick={() => downloadExport("geojson", show)}
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
                title="Download polygons + all properties as GeoJSON"
              >
                <Download className="w-3.5 h-3.5" /> GeoJSON
              </button>
              <button
                onClick={() => downloadExport("xlsx", show)}
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
                title="Download as Excel (polygons as WKT)"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
              <button
                onClick={() => { setAddingSett(true); setEditingSett(null); }}
                disabled={addingSett}
                className="btn-primary"
              >
                <Plus className="w-3.5 h-3.5" /> Add settlement
              </button>
            </div>
          </div>

          {addingSett && (
            <div className="mb-4">
              <SettForm
                initial={emptySett()}
                clusters={clusters}
                zones={zones}
                partners={partners}
                onSave={createSett}
                onCancel={() => setAddingSett(false)}
              />
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="space-y-2">
              {settlements.map(s => (
                <div key={s.id}>
                  {editingSett?.id === s.id ? (
                    <SettForm
                      initial={{ name: s.name, clusterId: s.clusterId, partnerId: s.partnerId, polygon: s.polygon, centroidLat: s.centroidLat, centroidLng: s.centroidLng }}
                      clusters={clusters}
                      zones={zones}
                      partners={partners}
                      onSave={(data) => updateSett(s.id, data)}
                      onCancel={() => setEditingSett(null)}
                    />
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                      <SquarePen className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                          {s.polygon
                            ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">has polygon</span>
                            : <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full font-medium">no polygon</span>
                          }
                          {s.partner && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: s.partner.color + "22", color: s.partner.color }}>
                              {s.partner.label}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-400">
                          <span>Cluster: <span className="text-slate-600">{s.cluster.name.replace(/_/g, " ")}</span></span>
                          <span>Zone: <span className="text-slate-600">{s.cluster.zone.name}</span></span>
                          {(s.centroidLat && s.centroidLng) && (
                            <span className="font-mono">{s.centroidLat.toFixed(4)}, {s.centroidLng.toFixed(4)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Link href={`/needs/settlement/${s.id}`} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Assess settlement">
                          <ClipboardList className="w-3.5 h-3.5" />
                        </Link>
                        <button onClick={() => { setEditingSett(s); setAddingSett(false); }} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteSett(s.id, s.name)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Toast msg={msg} />
    </div>
    </SurfaceProvider>
  );
}

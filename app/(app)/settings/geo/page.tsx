"use client";

// Unified editable geography canvas (Track G). Spatial editing surface: drag facility points to
// move them, redraw a settlement boundary, reassign a facility's settlement — all persisted via the
// existing admin routes. Hierarchy (zone/cluster rename/move) stays at /settings/geography, linked.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronLeft, MapPin, Hexagon, Search, ExternalLink } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import type { GeoFacility, GeoSettlement } from "@/components/geo/GeographyCanvas";

const GeographyCanvas = dynamic(() => import("@/components/geo/GeographyCanvas"), { ssr: false });

type Selected = { kind: "facility"; f: GeoFacility } | { kind: "settlement"; id: string } | null;

export default function GeographyCanvasPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [city, setCity] = useState("bangalore");
  const [editable, setEditable] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [facilities, setFacilities] = useState<GeoFacility[]>([]);
  const [settlements, setSettlements] = useState<GeoSettlement[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Selected>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const layers: { layerKey: string }[] = await fetch("/api/admin/facility-layers").then((r) => r.json()).catch(() => []);
    const perLayer = await Promise.all((layers ?? []).map((l) =>
      fetch(`/api/admin/layer-features?layerKey=${encodeURIComponent(l.layerKey)}`).then((r) => r.json()).catch(() => [])
    ));
    const facs: GeoFacility[] = perLayer.flat().filter((f: GeoFacility) => f.lat != null && f.lng != null)
      .map((f: { id: string; name: string; lat: number; lng: number; layerKey: string; settlementId: string | null }) => ({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, layerKey: f.layerKey, settlementId: f.settlementId ?? null }));
    setFacilities(facs);
    const setts: { id: string; name: string; polygon: unknown }[] = await fetch("/api/admin/settlements").then((r) => r.json()).catch(() => []);
    setSettlements((setts ?? []).map((s) => ({ id: s.id, name: s.name, polygon: s.polygon })));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);

  const selectedId = selected?.kind === "facility" ? selected.f.id : selected?.kind === "settlement" ? selected.id : null;

  const onMoveFacility = useCallback(async (id: string, lat: number, lng: number) => {
    setFacilities((prev) => prev.map((f) => (f.id === id ? { ...f, lat, lng } : f)));
    await fetch(`/api/admin/layer-features/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) });
    setMsg("Moved facility");
  }, []);

  const onDrawnPolygon = useCallback(async (ring: number[][]) => {
    if (selected?.kind !== "settlement") { setMsg("Select a settlement first, then Draw."); return; }
    const polygon = { type: "Polygon", coordinates: [ring] };
    setSettlements((prev) => prev.map((s) => (s.id === selected.id ? { ...s, polygon } : s)));
    await fetch(`/api/admin/settlements/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ polygon }) });
    setMsg("Saved new boundary");
  }, [selected]);

  const onPolygonEdited = useCallback(async (id: string, polygon: unknown) => {
    setSettlements((prev) => prev.map((s) => (s.id === id ? { ...s, polygon } : s)));
    await fetch(`/api/admin/settlements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ polygon }) });
    setMsg("Boundary updated");
  }, []);

  const saveFacility = useCallback(async (id: string, data: Partial<{ name: string; settlementId: string | null }>) => {
    setFacilities((prev) => prev.map((f) => (f.id === id ? { ...f, ...data } as GeoFacility : f)));
    await fetch(`/api/admin/layer-features/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setMsg("Saved");
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const facs = facilities.filter((f) => !t || f.name.toLowerCase().includes(t));
    const setts = settlements.filter((s) => !t || s.name.toLowerCase().includes(t));
    return { facs, setts };
  }, [q, facilities, settlements]);

  if (!isAdmin) return null;
  const selFac = selected?.kind === "facility" ? selected.f : null;
  const selSet = selected?.kind === "settlement" ? settlements.find((s) => s.id === selected.id) : null;

  return (
    <SurfaceProvider id="settings.index">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/settings" className="text-stone-400 hover:text-stone-600"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-stone-900">Geography Canvas</h1>
            <p className="text-xs text-stone-400">Move facilities · redraw settlement boundaries · reassign — spatially.</p>
          </div>
          <select value={city} onChange={(e) => setCity(e.target.value)} className="px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white">
            <option value="bangalore">Bangalore</option>
            <option value="chennai">Chennai</option>
          </select>
          <button onClick={() => { setEditable((v) => !v); setDrawMode(false); }} className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${editable ? "bg-stone-900 text-white border-stone-900" : "text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
            {editable ? "Editing" : "Edit"}
          </button>
          <Link href="/settings/geography" className="text-xs text-sky-600 hover:text-sky-800 inline-flex items-center gap-1">Hierarchy editor <ExternalLink className="w-3 h-3" /></Link>
        </div>

        {msg && <div className="mb-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">{msg}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-3" style={{ height: "72vh" }}>
          {/* List */}
          <div className="border border-stone-200 rounded-xl bg-white flex flex-col overflow-hidden">
            <div className="p-2 border-b border-stone-100 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-stone-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="flex-1 text-sm outline-none" />
            </div>
            <div className="flex-1 overflow-y-auto text-sm">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-stone-400">Facilities ({filtered.facs.length})</div>
              {filtered.facs.slice(0, 300).map((f) => (
                <button key={f.id} onClick={() => setSelected({ kind: "facility", f })} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-stone-50 ${selectedId === f.id ? "bg-sky-50" : ""}`}>
                  <MapPin className="w-3.5 h-3.5 text-violet-500 shrink-0" /><span className="truncate">{f.name}</span>
                </button>
              ))}
              <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-stone-400">Settlements ({filtered.setts.length})</div>
              {filtered.setts.slice(0, 300).map((s) => (
                <button key={s.id} onClick={() => setSelected({ kind: "settlement", id: s.id })} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-stone-50 ${selectedId === s.id ? "bg-amber-50" : ""}`}>
                  <Hexagon className="w-3.5 h-3.5 text-amber-500 shrink-0" /><span className="truncate">{s.name}</span>{!s.polygon && <span className="text-[9px] text-stone-400 ml-auto">no shape</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div className="min-h-0">
            <GeographyCanvas
              city={city}
              editable={editable}
              drawMode={drawMode}
              selectedId={selectedId}
              facilities={facilities}
              settlements={settlements}
              zonesUrl={`/api/map/geojson/zones?city=${city}`}
              clustersUrl={`/api/map/geojson/clusters?city=${city}`}
              onSelectFacility={(f) => setSelected({ kind: "facility", f })}
              onSelectSettlement={(id) => setSelected({ kind: "settlement", id })}
              onMoveFacility={onMoveFacility}
              onDrawnPolygon={onDrawnPolygon}
              onPolygonEdited={onPolygonEdited}
            />
          </div>

          {/* Inspector */}
          <div className="border border-stone-200 rounded-xl bg-white p-4 overflow-y-auto">
            {selFac ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">Facility · {selFac.layerKey}</div>
                <input defaultValue={selFac.name} key={`n-${selFac.id}`} onBlur={(e) => e.target.value.trim() && e.target.value !== selFac.name && saveFacility(selFac.id, { name: e.target.value.trim() })} className="w-full px-2 py-1.5 text-sm border border-stone-200 rounded-lg" />
                <div className="text-[11px] text-stone-500">lat {selFac.lat?.toFixed(5)}, lng {selFac.lng?.toFixed(5)}</div>
                <label className="block text-[11px] text-stone-500">Settlement</label>
                <select defaultValue={selFac.settlementId ?? ""} key={`s-${selFac.id}`} onChange={(e) => saveFacility(selFac.id, { settlementId: e.target.value || null })} className="w-full px-2 py-1.5 text-sm border border-stone-200 rounded-lg bg-white">
                  <option value="">— none —</option>
                  {settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {editable && <p className="text-[11px] text-stone-400 pt-1">Drag the point on the map to move it.</p>}
              </div>
            ) : selSet ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">Settlement</div>
                <div className="text-sm font-medium text-stone-900">{selSet.name}</div>
                <div className="text-[11px] text-stone-500">{selSet.polygon ? "Has a boundary" : "No boundary yet"}</div>
                {editable ? (
                  <button onClick={() => setDrawMode((v) => !v)} className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${drawMode ? "bg-emerald-600 text-white border-emerald-600" : "text-stone-700 border-stone-200 hover:bg-stone-50"}`}>
                    {drawMode ? "Finish drawing (saves)" : "Draw / redraw boundary"}
                  </button>
                ) : <p className="text-[11px] text-stone-400">Turn on Edit to redraw the boundary.</p>}
                {drawMode && <p className="text-[11px] text-emerald-700">Click on the map to place boundary points, then click “Finish drawing”.</p>}
                {editable && !drawMode && selSet.polygon != null && <p className="text-[11px] text-stone-400">Drag the green vertices on the map to fine-tune the boundary.</p>}
              </div>
            ) : (
              <p className="text-xs text-stone-400">Select a facility or settlement — from the list or the map — to edit it.</p>
            )}
          </div>
        </div>
      </div>
    </SurfaceProvider>
  );
}

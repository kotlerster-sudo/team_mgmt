"use client";

import { useState } from "react";
import { X, Crosshair } from "lucide-react";

// Create a facility with a real location. lat/lng prefill from the chosen
// settlement's centroid; the admin can adjust or drop their current GPS position.
export function NewFacilityModal({
  layerKey, clusterId, settlementId, defaultName, defaultLat, defaultLng, onClose, onCreated,
}: {
  layerKey: string;
  clusterId: string | null;
  settlementId: string | null;
  defaultName?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  onClose: () => void;
  onCreated: (facility: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const [centreType, setCentreType] = useState("");
  const [lat, setLat] = useState<string>(defaultLat != null ? String(defaultLat) : "");
  const [lng, setLng] = useState<string>(defaultLng != null ? String(defaultLng) : "");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const usingCentroid = defaultLat != null && String(defaultLat) === lat && defaultLng != null && String(defaultLng) === lng;

  const useMyLocation = () => {
    if (!navigator.geolocation) return alert("Geolocation not available");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setLocating(false); },
      () => { alert("Couldn't get your location"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), layerKey, clusterId, settlementId, centreType: centreType.trim() || undefined };
      if (lat !== "" && lng !== "") { body.lat = Number(lat); body.lng = Number(lng); }
      const r = await fetch(`/api/field/admin/facility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      if (r?.ok) onCreated(r.facility); else alert(r?.error ?? "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between"><h3 className="text-base font-semibold text-stone-900">New facility</h3><button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={20} /></button></div>
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Facility name" className="fac-inp" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">Centre type (optional)</span><input value={centreType} onChange={(e) => setCentreType(e.target.value)} placeholder="e.g. CFAR Creche" className="fac-inp" /></label>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500">Location</span>
              <button type="button" onClick={useMyLocation} disabled={locating} className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 disabled:opacity-50"><Crosshair size={12} /> {locating ? "Locating…" : "Use my location"}</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" inputMode="decimal" className="fac-inp" />
              <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" inputMode="decimal" className="fac-inp" />
            </div>
            <p className="mt-1 text-[11px] text-stone-400">
              {lat === "" || lng === "" ? "No coordinates — will default to the settlement centroid (approximate)." : usingCentroid ? "Using the settlement centroid (approximate) — adjust or use your location for the exact spot." : "Custom coordinates."}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
          <button disabled={busy || !name.trim()} onClick={create} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">Create facility</button>
        </div>
        <style>{`.fac-inp{height:2.25rem;width:100%;border:1px solid rgb(231 229 228);border-radius:0.5rem;padding:0 0.6rem;font-size:0.875rem;outline:none}.fac-inp:focus{border-color:rgb(168 162 158)}`}</style>
      </div>
    </div>
  );
}

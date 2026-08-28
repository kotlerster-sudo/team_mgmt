"use client";

import { LAYERS, type LayerKey, type MapCity } from "@/lib/layers";
import { type MapFilter } from "@/lib/mapFilter";
import type { FacilityLayer } from "@/components/map/MapDashboard";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

interface LayerPanelProps {
  visibleLayers: Set<LayerKey>;
  onToggle: (key: LayerKey) => void;
  onClose?: () => void;
  featureCounts: Partial<Record<LayerKey, number>>;
  /** DB-backed settlement count for the active city (matches /needs field coverage). */
  settlementDbCount?: number;
  /** "Mine" toggle: when true, map shows only clusters/settlements the user has a goal in. */
  mineMode?: boolean;
  onToggleMineMode?: () => void;
  activeZone: string | null;
  activeCluster: string | null;
  onZoneSelect: (zone: string | null) => void;
  onClusterSelect: (cluster: string | null) => void;
  zoneIndex: Record<string, string[]>;
  clusterIndex: Record<string, { zone: string; settlements: string[]; display?: string }>;
  tab: "layers" | "zones" | "clusters";
  onTabChange: (t: "layers" | "zones" | "clusters") => void;
  mapFilter: MapFilter | null;
  onPartnerFilter: (key: LayerKey | null) => void;
  onClearFilter: () => void;
  activeCity: MapCity;
  onCityChange: (city: MapCity) => void;
  schoolMaxKm: number;
  onSchoolMaxKmChange: (km: number) => void;
  schoolTypes: Set<string>;
  onSchoolTypesChange: (types: Set<string>) => void;
  schoolCount: number;
  canteenMaxKm: number;
  onCanteenMaxKmChange: (km: number) => void;
  canteenCount: number;
  healthTypes: Set<string>;
  onHealthTypesChange: (types: Set<string>) => void;
  healthCount: number;
  showHealthClusters: boolean;
  onShowHealthClustersChange: (v: boolean) => void;
  facilityLayers?: FacilityLayer[];
}

const ZONE_COLORS: Record<string, string> = {
  North: "#6366f1",
  South: "#10b981",
  Central: "#f59e0b",
  West: "#ef4444",
  // Chennai zones (keyed by full name)
  "Chennai \u2013 Central": "#f59e0b",
  "Chennai \u2013 North": "#6366f1",
  "Chennai \u2013 Resettlement": "#8b5cf6",
};

const CLUSTER_ZONE_COLORS: Record<string, string> = {
  North: "#e0e7ff",
  South: "#d1fae5",
  Central: "#fef3c7",
  West: "#fee2e2",
  "Chennai \u2013 Central": "#fef3c7",
  "Chennai \u2013 North": "#e0e7ff",
  "Chennai \u2013 Resettlement": "#ede9fe",
};

const CLUSTER_ZONE_TEXT: Record<string, string> = {
  North: "#4338ca",
  South: "#065f46",
  Central: "#92400e",
  West: "#991b1b",
  "Chennai \u2013 Central": "#92400e",
  "Chennai \u2013 North": "#4338ca",
  "Chennai \u2013 Resettlement": "#5b21b6",
};

export default function LayerPanel({
  visibleLayers,
  onToggle,
  onClose,
  featureCounts,
  settlementDbCount,
  activeZone,
  activeCluster,
  onZoneSelect,
  onClusterSelect,
  zoneIndex,
  clusterIndex,
  tab,
  onTabChange,
  mapFilter,
  onPartnerFilter,
  onClearFilter,
  activeCity,
  onCityChange,
  schoolMaxKm,
  onSchoolMaxKmChange,
  schoolTypes,
  onSchoolTypesChange,
  schoolCount,
  canteenMaxKm,
  onCanteenMaxKmChange,
  canteenCount,
  healthTypes,
  onHealthTypesChange,
  healthCount,
  showHealthClusters,
  onShowHealthClustersChange,
  facilityLayers = [],
  mineMode = false,
  onToggleMineMode,
}: LayerPanelProps) {
  // Filter layers by active city
  const polygonLayers = LAYERS.filter((l) => l.type === "polygon" && l.city === activeCity);
  // Static point layers (resource_centres) + dynamic facility layers from DB
  const staticPointLayers = LAYERS.filter((l) => l.type === "point" && l.city === activeCity && l.key !== "schools" && l.key !== "health_centres");

  const polygonFeatureTotal = polygonLayers.reduce(
    (sum, l) => sum + (featureCounts[l.key] ?? 0),
    0
  );
  // Prefer DB-backed count (matches /needs field coverage). Fall back to polygon
  // feature count until /api/geo loads.
  const totalSettlements = settlementDbCount ?? polygonFeatureTotal;
  const totalCentres =
    facilityLayers.reduce((sum, fl) => sum + (featureCounts[fl.layerKey] ?? 0), 0) +
    staticPointLayers.reduce((sum, l) => sum + (featureCounts[l.key] ?? 0), 0);

  // Group clusters by zone, filtered to active city
  const cityPrefix = activeCity === "chennai" ? "Chennai" : "";
  const clustersByZone: Record<string, string[]> = {};
  Object.entries(clusterIndex).forEach(([cluster, data]) => {
    const zone = data.zone;
    // Only include clusters whose zone belongs to the active city
    const isChennaiZone = zone.startsWith("Chennai");
    if (activeCity === "chennai" ? !isChennaiZone : isChennaiZone) return;
    if (!clustersByZone[zone]) clustersByZone[zone] = [];
    clustersByZone[zone].push(cluster);
  });
  void cityPrefix; // suppress unused warning

  return (
    <SurfaceProvider id="map.layer_panel">
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
            <span className="text-white text-xs font-bold">U</span>
          </div>
          <span className="font-bold text-slate-800 text-sm flex-1">Urban Program</span>
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Close panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
        {/* City toggle */}
        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => onCityChange("bangalore")}
            className={`flex-1 py-1.5 transition-colors ${activeCity === "bangalore" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            Bangalore
          </button>
          <button
            onClick={() => onCityChange("chennai")}
            className={`flex-1 py-1.5 transition-colors border-l border-slate-200 ${activeCity === "chennai" ? "bg-sky-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            Chennai
          </button>
        </div>
        {/* Mine / All toggle */}
        {onToggleMineMode && (
          <div className="mt-2 flex rounded-lg overflow-hidden border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => mineMode && onToggleMineMode()}
              className={`flex-1 py-1.5 transition-colors ${!mineMode ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              title="Show every cluster and settlement"
            >
              All
            </button>
            <button
              onClick={() => !mineMode && onToggleMineMode()}
              className={`flex-1 py-1.5 transition-colors border-l border-slate-200 ${mineMode ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              title="Show only clusters and settlements where you own or co-own a goal"
            >
              Mine
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 grid grid-cols-2 gap-2 flex-shrink-0">
        <div
          className="text-center"
          title={
            settlementDbCount !== undefined && polygonFeatureTotal !== settlementDbCount
              ? `${settlementDbCount} settlements in records · ${polygonFeatureTotal} polygons drawn on map`
              : undefined
          }
        >
          <div className="text-base font-bold text-indigo-700">{totalSettlements}</div>
          <div className="text-xs text-indigo-400">Settlements</div>
        </div>
        <div className="text-center">
          <div className="text-base font-bold text-indigo-700">{totalCentres}</div>
          <div className="text-xs text-indigo-400">Centres</div>
        </div>
      </div>
      {/* Centre breakdown — Bangalore only, dynamic */}
      {activeCity === "bangalore" && facilityLayers.length > 0 && (() => {
        // Wrap into rows of at most 4 so labels stay readable.
        const perRow = facilityLayers.length <= 4 ? facilityLayers.length : Math.ceil(facilityLayers.length / 2);
        return (
          <div
            className="px-3 py-2 border-b border-slate-100 grid gap-y-2 gap-x-1 flex-shrink-0"
            style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
          >
            {facilityLayers.map(fl => {
              const shortLabel = fl.label
                .replace(/ Centre[s]?$/i, "")
                .replace(/ Kitchen[s]?$/i, "")
                .replace(/ Complex$/i, "")
                .replace(/^Community /i, "");
              return (
                <div key={fl.layerKey} className="text-center min-w-0">
                  <div className="text-sm font-bold" style={{ color: fl.color }}>{featureCounts[fl.layerKey] ?? 0}</div>
                  <div className="text-[11px] text-slate-500 leading-tight truncate" title={fl.label}>{shortLabel}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Active filter banner — shown for any filter source */}
      {mapFilter && (
        <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between flex-shrink-0">
          <div className="text-xs font-semibold text-indigo-800 truncate pr-2">
            {mapFilter.label}
          </div>
          <button
            onClick={onClearFilter}
            className="text-xs text-indigo-600 hover:text-indigo-900 font-bold flex-shrink-0"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-100 flex-shrink-0">
        {(["layers", "zones", "clusters"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`flex-1 text-xs font-semibold py-2 capitalize transition-colors ${
              tab === t
                ? "text-indigo-600 border-b-2 border-indigo-500"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-16 sm:pb-0">
        {/* --- LAYERS TAB --- */}
        {tab === "layers" && (
          <div className="px-3 py-3 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Partners
              </p>
              <div className="space-y-0.5">
                {polygonLayers.map((layer) => {
                  const active = visibleLayers.has(layer.key);
                  const isFiltered = mapFilter?.source === "partner" && mapFilter.partnerKeys.has(layer.key);
                  const isHighlighted = mapFilter && mapFilter.partnerKeys.has(layer.key);
                  const dimmed = mapFilter && mapFilter.partnerKeys.size > 0 && !mapFilter.partnerKeys.has(layer.key);
                  return (
                    <div key={layer.key} className="flex items-center gap-1">
                      {/* Partner name — click to cross-filter */}
                      <button
                        onClick={() => onPartnerFilter(isFiltered ? null : layer.key)}
                        title={isFiltered ? "Clear filter" : `Filter all layers to ${layer.label}`}
                        className={`flex-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                          isFiltered
                            ? "bg-indigo-50 ring-1 ring-indigo-400 text-indigo-900"
                            : isHighlighted
                            ? "bg-indigo-50/60 text-indigo-800"
                            : dimmed
                            ? "opacity-35 hover:opacity-60 text-slate-600 hover:bg-slate-50"
                            : active ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ background: layer.color, opacity: active ? 1 : 0.3 }}
                        />
                        <span className="flex-1 text-xs font-medium">{layer.label}</span>
                        {isFiltered && <span className="text-[10px] text-indigo-500 font-bold">✦</span>}
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${active ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                          {featureCounts[layer.key] ?? 0}
                        </span>
                      </button>
                      {/* Eye toggle — separate from filter */}
                      <button
                        onClick={() => onToggle(layer.key)}
                        title={active ? "Hide layer" : "Show layer"}
                        className="p-1 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                      >
                        {active ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Points
              </p>
              <div className="space-y-0.5">
                {/* Dynamic facility layers from DB */}
                {facilityLayers.map((fl) => {
                  const active = visibleLayers.has(fl.layerKey);
                  return (
                    <button
                      key={fl.layerKey}
                      onClick={() => onToggle(fl.layerKey)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        active ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: fl.color, opacity: active ? 1 : 0.3 }} />
                      <span className="flex-1 text-xs font-medium">{fl.label}</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${active ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                        {featureCounts[fl.layerKey] ?? 0}
                      </span>
                    </button>
                  );
                })}
                {/* Static point layers (resource centres etc.) */}
                {staticPointLayers.map((layer) => {
                  const active = visibleLayers.has(layer.key);
                  return (
                    <button
                      key={layer.key}
                      onClick={() => onToggle(layer.key)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        active ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: layer.color, opacity: active ? 1 : 0.3 }} />
                      <span className="flex-1 text-xs font-medium">{layer.label}</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${active ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                        {featureCounts[layer.key] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Schools layer (Bangalore only) */}
            {activeCity === "bangalore" && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Schools
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => onToggle("schools")}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                      visibleLayers.has("schools") ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: "#16a34a", opacity: visibleLayers.has("schools") ? 1 : 0.3 }}
                    />
                    <span className="flex-1 text-xs font-medium">Govt Schools</span>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${visibleLayers.has("schools") ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                      {schoolCount}
                    </span>
                  </button>
                  {visibleLayers.has("schools") && (
                    <div className="px-2.5 py-2 bg-green-50 rounded-lg space-y-2">
                      {/* Type filters */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-green-600 mb-1">Type</p>
                        {[
                          { key: "Government",            label: "Government (DPI)", color: "#dc2626" },
                          { key: "BBMP",                  label: "BBMP",             color: "#1e293b" },
                          { key: "Karnataka Public School",label: "KPS",             color: "#0288D1" },
                        ].map(({ key, label, color }) => (
                          <label key={key} className="flex items-center gap-2 py-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={schoolTypes.has(key)}
                              onChange={() => {
                                const next = new Set(schoolTypes);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                onSchoolTypesChange(next);
                              }}
                              className="accent-green-600 w-3 h-3"
                            />
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                            <span className="text-xs text-green-800">{label}</span>
                          </label>
                        ))}
                      </div>
                      {/* Distance slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-green-600">Max distance</span>
                          <span className="text-xs font-bold text-green-800">{schoolMaxKm} km</span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={schoolMaxKm}
                          onChange={e => onSchoolMaxKmChange(parseFloat(e.target.value))}
                          className="w-full accent-green-600 h-1.5"
                        />
                        <div className="flex justify-between text-[10px] text-green-400 mt-0.5">
                          <span>0.5 km</span>
                          <span>10 km</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Indira Canteens layer (Bangalore only) */}
            {activeCity === "bangalore" && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Food
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => onToggle("canteens")}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                      visibleLayers.has("canteens") ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: "#ea580c", opacity: visibleLayers.has("canteens") ? 1 : 0.3 }}
                    />
                    <span className="flex-1 text-xs font-medium">Indira Canteens</span>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${visibleLayers.has("canteens") ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                      {canteenCount}
                    </span>
                  </button>
                  {visibleLayers.has("canteens") && (
                    <div className="px-2.5 py-2 bg-orange-50 rounded-lg space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600">Max distance</span>
                          <span className="text-xs font-bold text-orange-800">{canteenMaxKm} km</span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={canteenMaxKm}
                          onChange={e => onCanteenMaxKmChange(parseFloat(e.target.value))}
                          className="w-full accent-orange-600 h-1.5"
                        />
                        <div className="flex justify-between text-[10px] text-orange-400 mt-0.5">
                          <span>0.5 km</span>
                          <span>10 km</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Health Centres layer (Bangalore only) */}
            {activeCity === "bangalore" && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Health
                </p>
                <div className="space-y-1">
                  {/* Layer toggle */}
                  <button
                    onClick={() => onToggle("health_centres")}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                      visibleLayers.has("health_centres") ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#e11d48", opacity: visibleLayers.has("health_centres") ? 1 : 0.3 }} />
                    <span className="flex-1 text-xs font-medium">Health Centres</span>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${visibleLayers.has("health_centres") ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-300"}`}>
                      {healthCount}
                    </span>
                  </button>

                  {/* Sub-type filters — shown when layer is on */}
                  {visibleLayers.has("health_centres") && (
                    <div className="px-2.5 py-2 bg-rose-50 rounded-lg space-y-1">
                      {[
                        { key: "CRC",                      label: "CRC",                    color: "#7c3aed" },
                        { key: "Foundation Health Centre", label: "Foundation Health Centre",color: "#0284c7" },
                        { key: "Government Health Centre", label: "Govt Health Centre (PHC/CHC)", color: "#059669" },
                        { key: "Referral Helpdesk Hospital",label: "Referral Hospital",     color: "#d97706" },
                        { key: "Super Speciality Hospital",label: "Super Speciality",       color: "#dc2626" },
                      ].map(({ key, label, color }) => (
                        <label key={key} className="flex items-center gap-2 py-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={healthTypes.has(key)}
                            onChange={() => {
                              const next = new Set(healthTypes);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              onHealthTypesChange(next);
                            }}
                            className="w-3 h-3"
                            style={{ accentColor: color }}
                          />
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                          <span className="text-xs text-rose-900">{label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Health / Non-health cluster toggle */}
                  <div className="flex items-center justify-between px-2.5 py-2 bg-slate-50 rounded-lg mt-1">
                    <span className="text-xs font-medium text-slate-600">Health cluster overlay</span>
                    <button
                      onClick={() => onShowHealthClustersChange(!showHealthClusters)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${showHealthClusters ? "bg-rose-500" : "bg-slate-300"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${showHealthClusters ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  {showHealthClusters && (
                    <div className="flex gap-3 px-2.5 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-400 inline-block" /> Health cluster</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-300 inline-block" /> No coverage</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Show/Hide all */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => LAYERS.forEach((l) => !visibleLayers.has(l.key) && onToggle(l.key))}
                className="flex-1 text-xs font-semibold text-indigo-600 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50"
              >
                Show All
              </button>
              <button
                onClick={() => LAYERS.forEach((l) => visibleLayers.has(l.key) && onToggle(l.key))}
                className="flex-1 text-xs font-semibold text-slate-500 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Hide All
              </button>
            </div>
          </div>
        )}

        {/* --- ZONES TAB --- */}
        {tab === "zones" && (
          <div className="px-3 py-3">
            <p className="text-xs text-slate-400 mb-3">
              {mapFilter?.zones.size ? `Filtered to ${mapFilter.zones.size} zone(s).` : "Click a zone to highlight its settlements on the map."}
            </p>
            <div className="space-y-2">
              {Object.entries(zoneIndex).sort()
                .filter(([zone]) => {
                  const isChennai = zone.startsWith("Chennai");
                  return (activeCity === "chennai" ? isChennai : !isChennai)
                    && (!mapFilter?.zones.size || mapFilter.zones.has(zone));
                })
                .map(([zone, settlements]) => {
                const displayZone = zone.replace(/^Chennai\s*[–-]\s*/u, "");
                const isActive = activeZone === zone && !activeCluster;
                const color = ZONE_COLORS[zone] ?? "#64748b";
                return (
                  <button
                    key={zone}
                    onClick={() => {
                      onClusterSelect(null);
                      onZoneSelect(isActive ? null : zone);
                    }}
                    className={`w-full text-left rounded-xl p-3 border-2 transition-all ${
                      isActive
                        ? "border-current shadow-md"
                        : "border-transparent hover:border-slate-200"
                    }`}
                    style={{
                      background: isActive ? color + "18" : "#f8fafc",
                      borderColor: isActive ? color : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ background: color }}
                        />
                        <span
                          className="text-sm font-bold"
                          style={{ color: isActive ? color : "#1e293b" }}
                        >
                          {displayZone}
                        </span>
                      </div>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: isActive ? color + "30" : "#e2e8f0",
                          color: isActive ? color : "#64748b",
                        }}
                      >
                        {settlements.length}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* --- CLUSTERS TAB --- */}
        {tab === "clusters" && (
          <div className="px-3 py-3">
            <p className="text-xs text-slate-400 mb-3">
              {mapFilter?.clusters.size ? `Filtered to ${mapFilter.clusters.size} cluster(s).` : "Click a cluster to focus on it."}
            </p>
            {Object.entries(clustersByZone)
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(([zone]) => !mapFilter?.zones.size || mapFilter.zones.has(zone))
              .map(([zone, clusters]) => (
                <div key={zone} className="mb-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: ZONE_COLORS[zone] ?? "#64748b" }}
                    />
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                      {zone.replace(/^Chennai\s*[–-]\s*/u, "")} Zone
                    </p>
                  </div>
                  <div className="space-y-1">
                    {clusters.sort()
                      .filter(c => !mapFilter?.clusters.size || mapFilter.clusters.has(c))
                      .map((cluster) => {
                      const data = clusterIndex[cluster];
                      const isActive = activeCluster === cluster;
                      const bgColor = CLUSTER_ZONE_COLORS[zone] ?? "#f1f5f9";
                      const textColor = CLUSTER_ZONE_TEXT[zone] ?? "#334155";
                      return (
                        <button
                          key={cluster}
                          onClick={() => {
                            onZoneSelect(null);
                            onClusterSelect(isActive ? null : cluster);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors ${
                            isActive ? "shadow-sm" : "hover:bg-slate-50"
                          }`}
                          style={
                            isActive
                              ? { background: bgColor, color: textColor }
                              : {}
                          }
                        >
                          <span
                            className={`text-xs font-semibold ${isActive ? "" : "text-slate-700"}`}
                          >
                            {data?.display ?? cluster.replace(/_/g, " ")}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                              isActive ? "" : "bg-slate-100 text-slate-500"
                            }`}
                            style={isActive ? { background: bgColor, color: textColor } : {}}
                          >
                            {data?.settlements?.length ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
    </SurfaceProvider>
  );
}

// Static layer keys — settlement polygons and fixed system layers.
// Facility centre types (children_centres, youth_centres, creches, etc.) are
// DB-driven via FacilityLayerConfig and loaded dynamically at runtime.
export type LayerKey =
  | "sangama"
  | "gubbachi"
  | "cfar"
  | "actionaid"
  | "janasha"
  | "thamate"
  | "maarga"
  | "sieds"

  // Chennai partners
  | "arunodhaya"
  | "tndwwt"
  | "dbai"
  | "dbsss"
  | "thozhamai"

  | "resource_centres"
  | "custom"
  | "custom_settlements"
  | "schools"
  | "health_centres"
  | "canteens"
  // Dynamic facility layer keys from FacilityLayerConfig are plain strings at runtime.
  | (string & {});

export type MapCity = "bangalore" | "chennai";

export interface LayerConfig {
  key: LayerKey;
  label: string;
  // API URL to fetch GeoJSON from. Empty string = loaded separately (schools, health_centres, custom).
  file: string;
  color: string;
  type: "polygon" | "point";
  description: string;
  city: MapCity;
}

export const LAYERS: LayerConfig[] = [
  // ── Bangalore partners ────────────────────────────────────────────────────
  { key: "sangama",   label: "Sangama",    file: "/api/map/geojson/settlements?partner=sangama",   color: "#6366f1", type: "polygon", city: "bangalore", description: "Sangama partner settlements" },
  { key: "cfar",      label: "CFAR",       file: "/api/map/geojson/settlements?partner=cfar",      color: "#10b981", type: "polygon", city: "bangalore", description: "CFAR partner settlements" },
  { key: "actionaid", label: "ActionAid",  file: "/api/map/geojson/settlements?partner=actionaid", color: "#ef4444", type: "polygon", city: "bangalore", description: "ActionAid partner settlements" },
  { key: "gubbachi",  label: "Gubbachi",   file: "/api/map/geojson/settlements?partner=gubbachi",  color: "#f59e0b", type: "polygon", city: "bangalore", description: "Gubbachi partner settlements" },
  { key: "sieds",     label: "SIEDS",      file: "/api/map/geojson/settlements?partner=sieds",     color: "#ec4899", type: "polygon", city: "bangalore", description: "SIEDS partner settlements" },
  { key: "janasha",   label: "Janashayog", file: "/api/map/geojson/settlements?partner=janasha",   color: "#8b5cf6", type: "polygon", city: "bangalore", description: "Janashayog partner settlements" },
  { key: "maarga",    label: "Maarga",     file: "/api/map/geojson/settlements?partner=maarga",    color: "#f97316", type: "polygon", city: "bangalore", description: "Maarga partner settlements" },
  { key: "thamate",   label: "Thamate",    file: "/api/map/geojson/settlements?partner=thamate",   color: "#06b6d4", type: "polygon", city: "bangalore", description: "Thamate partner settlements" },

  // ── Chennai partners ──────────────────────────────────────────────────────
  { key: "arunodhaya", label: "Arunodhaya", file: "/api/map/geojson/settlements?partner=arunodhaya", color: "#0ea5e9", type: "polygon", city: "chennai", description: "Arunodhaya partner settlements — Chennai" },
  { key: "tndwwt",     label: "TNDWWT",     file: "/api/map/geojson/settlements?partner=tndwwt",     color: "#16a34a", type: "polygon", city: "chennai", description: "TNDWWT partner settlements — Chennai" },
  { key: "dbai",       label: "DBAI",       file: "/api/map/geojson/settlements?partner=dbai",       color: "#b45309", type: "polygon", city: "chennai", description: "DBAI partner settlements — Chennai" },
  { key: "dbsss",      label: "DBSSS",      file: "/api/map/geojson/settlements?partner=dbsss",      color: "#7c3aed", type: "polygon", city: "chennai", description: "DBSSS partner settlements — Chennai" },
  { key: "thozhamai",  label: "Thozhamai",  file: "/api/map/geojson/settlements?partner=thozhamai",  color: "#be123c", type: "polygon", city: "chennai", description: "Thozhamai partner settlements — Chennai" },

  // ── Resource centres (separate from FacilityLayerConfig) ──────────────────
  { key: "resource_centres", label: "Resource Centres", file: "/api/map/geojson/layer-features?layerKey=resource_centres", color: "#1d4ed8", type: "point", city: "bangalore", description: "Programme resource centres" },

  { key: "custom_settlements", label: "Custom Settlements", file: "", color: "#6366f1", type: "polygon", city: "bangalore", description: "User-added settlement polygons" },

  // ── Schools / Health (DB-backed, loaded via dedicated API handlers) ────────
  { key: "schools",        label: "Govt Schools",   file: "", color: "#16a34a", type: "point", city: "bangalore", description: "Government schools tagged to nearby settlements" },
  { key: "health_centres", label: "Health Centres", file: "", color: "#e11d48", type: "point", city: "bangalore", description: "Health centres tagged to nearby settlements" },
  { key: "canteens",       label: "Indira Canteens", file: "", color: "#ea580c", type: "point", city: "bangalore", description: "Indira Canteens tagged to nearby settlements" },
];

export const LAYER_MAP = Object.fromEntries(
  LAYERS.map((l) => [l.key, l])
) as Record<string, LayerConfig>;

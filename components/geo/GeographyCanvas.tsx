"use client";

// Editable geography canvas (Track G). A focused maplibre map (not the coupled MapView):
//   - renders zone + cluster polygons (read-only context, from the derived PostGIS feeds)
//   - renders settlement polygons + facility points (editable)
//   - facility points are DRAG-to-move (→ onMoveFacility with new lat/lng)
//   - "Draw" mode lets you retrace the selected settlement's polygon (→ onDrawnPolygon)
//   - clicking a facility/settlement selects it (→ onSelect*)
// Data comes from existing APIs; parent persists edits via the admin CRUD routes.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const CITY_CENTER: Record<string, { center: [number, number]; zoom: number }> = {
  bangalore: { center: [77.5946, 12.9716], zoom: 10.5 },
  chennai: { center: [80.2707, 13.0827], zoom: 10.5 },
};

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"], tileSize: 256, attribution: "© OpenStreetMap © CARTO" },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

export type GeoFacility = { id: string; name: string; lat: number; lng: number; layerKey: string; settlementId: string | null };
export type GeoSettlement = { id: string; name: string; polygon: unknown };

type FC = GeoJSON.FeatureCollection;
const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

export default function GeographyCanvas({
  city,
  editable,
  drawMode,
  selectedId,
  facilities,
  settlements,
  zonesUrl,
  clustersUrl,
  onSelectFacility,
  onSelectSettlement,
  onMoveFacility,
  onDrawnPolygon,
}: {
  city: string;
  editable: boolean;
  drawMode: boolean;
  selectedId: string | null;
  facilities: GeoFacility[];
  settlements: GeoSettlement[];
  zonesUrl: string;
  clustersUrl: string;
  onSelectFacility: (f: GeoFacility) => void;
  onSelectSettlement: (id: string) => void;
  onMoveFacility: (id: string, lat: number, lng: number) => void;
  onDrawnPolygon: (ring: number[][]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  // Latest props for use inside stable map event handlers.
  const stateRef = useRef({ editable, drawMode, facilities, onSelectFacility, onSelectSettlement, onMoveFacility, onDrawnPolygon });
  stateRef.current = { editable, drawMode, facilities, onSelectFacility, onSelectSettlement, onMoveFacility, onDrawnPolygon };
  const draftRef = useRef<number[][]>([]);

  const facilitiesFC = (list: GeoFacility[]): FC => ({
    type: "FeatureCollection",
    features: list.map((f) => ({ type: "Feature", id: f.id, geometry: { type: "Point", coordinates: [f.lng, f.lat] }, properties: { id: f.id, name: f.name, layerKey: f.layerKey } })),
  });
  const settlementsFC = (list: GeoSettlement[]): FC => ({
    type: "FeatureCollection",
    features: list.filter((s) => s.polygon).map((s) => ({ type: "Feature", id: s.id, geometry: s.polygon as GeoJSON.Geometry, properties: { id: s.id, name: s.name } })),
  });

  // Init map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: STYLE, center: CITY_CENTER[city]?.center ?? CITY_CENTER.bangalore.center, zoom: CITY_CENTER[city]?.zoom ?? 10.5 });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", async () => {
      loadedRef.current = true;
      // Context polygons (read-only)
      for (const [key, url] of [["zones", zonesUrl], ["clusters", clustersUrl]] as const) {
        try {
          const gj = await fetch(url).then((r) => r.json());
          map.addSource(key, { type: "geojson", data: gj });
          map.addLayer({ id: `${key}-fill`, type: "fill", source: key, paint: { "fill-color": key === "zones" ? "#6366f1" : "#0ea5e9", "fill-opacity": 0.04 } });
          map.addLayer({ id: `${key}-line`, type: "line", source: key, paint: { "line-color": key === "zones" ? "#6366f1" : "#0ea5e9", "line-width": key === "zones" ? 1.5 : 0.8, "line-opacity": 0.5 } });
        } catch { /* context layer best-effort */ }
      }
      // Settlements (editable-selectable)
      map.addSource("settlements", { type: "geojson", data: settlementsFC(settlements) });
      map.addLayer({ id: "settlements-fill", type: "fill", source: "settlements", paint: { "fill-color": "#f59e0b", "fill-opacity": ["case", ["==", ["get", "id"], selectedId ?? ""], 0.35, 0.12] } });
      map.addLayer({ id: "settlements-line", type: "line", source: "settlements", paint: { "line-color": "#d97706", "line-width": 1 } });
      // Draft polygon (draw mode)
      map.addSource("draft", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "draft-fill", type: "fill", source: "draft", paint: { "fill-color": "#10b981", "fill-opacity": 0.25 } });
      map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#059669", "line-width": 2, "line-dasharray": [2, 1] } });
      // Facilities (editable points)
      map.addSource("facilities", { type: "geojson", data: facilitiesFC(facilities) });
      map.addLayer({ id: "facilities-pts", type: "circle", source: "facilities", paint: { "circle-radius": 6, "circle-color": ["case", ["==", ["get", "id"], selectedId ?? ""], "#0ea5e9", "#7c3aed"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });

      // Select on click (facility takes priority, else settlement); in draw mode, add a vertex.
      map.on("click", (e) => {
        const s = stateRef.current;
        if (s.drawMode) {
          draftRef.current.push([e.lngLat.lng, e.lngLat.lat]);
          const ring = draftRef.current;
          const data: FC = ring.length >= 3
            ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] }, properties: {} }] }
            : { type: "FeatureCollection", features: ring.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} })) };
          (map.getSource("draft") as maplibregl.GeoJSONSource).setData(data);
          return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: ["facilities-pts", "settlements-fill"] });
        const fac = hits.find((h) => h.layer.id === "facilities-pts");
        if (fac) { const f = s.facilities.find((x) => x.id === fac.properties?.id); if (f) s.onSelectFacility(f); return; }
        const set = hits.find((h) => h.layer.id === "settlements-fill");
        if (set) s.onSelectSettlement(String(set.properties?.id));
      });

      // Drag a facility point.
      map.on("mousedown", "facilities-pts", (e) => {
        const s = stateRef.current;
        if (!s.editable || s.drawMode) return;
        e.preventDefault();
        const id = String(e.features?.[0]?.properties?.id);
        map.getCanvas().style.cursor = "grabbing";
        const src = map.getSource("facilities") as maplibregl.GeoJSONSource;
        const onMove = (ev: maplibregl.MapMouseEvent) => {
          const data = facilitiesFC(s.facilities.map((f) => (f.id === id ? { ...f, lat: ev.lngLat.lat, lng: ev.lngLat.lng } : f)));
          src.setData(data);
        };
        map.on("mousemove", onMove);
        map.once("mouseup", (ev) => {
          map.off("mousemove", onMove);
          map.getCanvas().style.cursor = "";
          s.onMoveFacility(id, ev.lngLat.lat, ev.lngLat.lng);
        });
      });
      map.on("mouseenter", "facilities-pts", () => { if (stateRef.current.editable) map.getCanvas().style.cursor = "grab"; });
      map.on("mouseleave", "facilities-pts", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => { map.remove(); mapRef.current = null; loadedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data updates to sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("facilities") as maplibregl.GeoJSONSource | undefined)?.setData(facilitiesFC(facilities));
    (map.getSource("settlements") as maplibregl.GeoJSONSource | undefined)?.setData(settlementsFC(settlements));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilities, settlements]);

  // Reflect selection highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (map.getLayer("facilities-pts")) map.setPaintProperty("facilities-pts", "circle-color", ["case", ["==", ["get", "id"], selectedId ?? ""], "#0ea5e9", "#7c3aed"]);
    if (map.getLayer("settlements-fill")) map.setPaintProperty("settlements-fill", "fill-opacity", ["case", ["==", ["get", "id"], selectedId ?? ""], 0.35, 0.12]);
  }, [selectedId]);

  // Finish/clear draft when leaving draw mode: emit the ring if it's a valid polygon.
  useEffect(() => {
    const map = mapRef.current;
    if (!drawMode && draftRef.current.length >= 3) {
      onDrawnPolygon([...draftRef.current, draftRef.current[0]]);
    }
    draftRef.current = [];
    if (map && loadedRef.current && map.getSource("draft")) (map.getSource("draft") as maplibregl.GeoJSONSource).setData(emptyFC());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode]);

  return <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden border border-stone-200" />;
}

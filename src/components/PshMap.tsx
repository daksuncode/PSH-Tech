import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { PSH_RAMP, regionName, type Period, type RegionProps, type Regions } from "../lib/psh";

// Free, keyless vector basemap built on OpenStreetMap data.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const INDONESIA_BOUNDS: [[number, number], [number, number]] = [[94, -11.5], [142, 7]];
const SOURCE = "regions";

type Props = {
  regions: Regions | null;
  period: Period;
  selectedId: number | null;
  onSelect: (region: RegionProps) => void;
};

function fillColor(period: Period): maplibregl.ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", `p${period}`],
    ...PSH_RAMP.flat(),
  ] as maplibregl.ExpressionSpecification;
}

const whenState = (key: string): maplibregl.ExpressionSpecification =>
  ["case", ["boolean", ["feature-state", key], false], 1, 0];

export default function PshMap({ regions, period, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const periodRef = useRef(period);
  const selectedRef = useRef<number | null>(null);
  onSelectRef.current = onSelect;
  periodRef.current = period;

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      bounds: INDONESIA_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    let hovered: number | string | undefined;
    const setHover = (id: number | string | undefined) => {
      if (hovered !== undefined) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = id;
      if (id !== undefined) map.setFeatureState({ source: SOURCE, id }, { hover: true });
    };

    map.on("mousemove", "regions-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      setHover(f.id);
      const p = f.properties as RegionProps;
      const v = Number(p[`p${periodRef.current}`]);
      // Built from DOM nodes: region names come from data, not trusted HTML.
      const content = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = regionName(p);
      const value = document.createElement("strong");
      value.textContent = `${v.toFixed(2)} jam/hari`;
      content.append(name, value);
      popup.setLngLat(e.lngLat).setDOMContent(content).addTo(map);
    });
    map.on("mouseleave", "regions-fill", () => {
      map.getCanvas().style.cursor = "";
      setHover(undefined);
      popup.remove();
    });
    map.on("click", "regions-fill", (e) => {
      const f = e.features?.[0];
      if (f) onSelectRef.current(f.properties as RegionProps);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add the region layers on first data, swap data on level change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !regions) return;
    const apply = () => {
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (source) {
        // Feature ids restart at 0 per level, so stale hover/selection must go.
        map.removeFeatureState({ source: SOURCE });
        selectedRef.current = null;
        source.setData(regions);
        return;
      }
      // Insert below the first symbol layer so place names stay readable.
      const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addSource(SOURCE, { type: "geojson", data: regions });
      map.addLayer({
        id: "regions-fill",
        type: "fill",
        source: SOURCE,
        paint: { "fill-color": fillColor(periodRef.current), "fill-opacity": 0.85 },
      }, firstLabel);
      map.addLayer({
        id: "regions-line",
        type: "line",
        source: SOURCE,
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.2, 10, 1],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 8, 0.8],
        },
      }, firstLabel);
      map.addLayer({
        id: "regions-hover",
        type: "line",
        source: SOURCE,
        paint: { "line-color": "#1f1e1c", "line-width": 1.2, "line-opacity": whenState("hover") },
      }, firstLabel);
      map.addLayer({
        id: "regions-selected",
        type: "line",
        source: SOURCE,
        paint: { "line-color": "#1f1e1c", "line-width": 2.5, "line-opacity": whenState("selected") },
      }, firstLabel);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [regions]);

  // Recolour when the selected month changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("regions-fill")) map.setPaintProperty("regions-fill", "fill-color", fillColor(period));
  }, [period]);

  // Outline the selected region.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE)) return;
    if (selectedRef.current !== null) {
      map.setFeatureState({ source: SOURCE, id: selectedRef.current }, { selected: false });
    }
    selectedRef.current = selectedId;
    if (selectedId !== null) map.setFeatureState({ source: SOURCE, id: selectedId }, { selected: true });
  }, [selectedId, regions]);

  return <div ref={container} className="map" aria-label="Peta Peak Sun Hours Indonesia" />;
}

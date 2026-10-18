import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import {
  NO_DATA_COLOR, formatSigned, rampFor, regionName, regionValue,
  type Period, type RegionProps, type Regions, type Source,
} from "../lib/psh";

// Free, keyless vector basemap built on OpenStreetMap data.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const INDONESIA_BOUNDS: [[number, number], [number, number]] = [[94, -11.5], [142, 7]];
const SOURCE = "regions";

type Props = {
  regions: Regions | null;
  source: Source;
  period: Period;
  selectedId: number | null;
  onSelect: (region: RegionProps) => void;
};

type Expr = maplibregl.ExpressionSpecification;

/** Same maths as regionValue() in lib/psh.ts, as a MapLibre expression. */
function valueExpr(source: Source, period: Period): Expr {
  const nasa: Expr = ["get", `p${period}`];
  const gsa: Expr = period === 0
    ? ["get", "g0"]
    : ["*", ["get", "g0"], ["/", ["get", `v${period}`], ["get", "v0"]]];
  return source === "nasa" ? nasa : source === "gsa" ? gsa : ["-", gsa, nasa];
}

function fillColor(source: Source, period: Period): Expr {
  const color = [
    "interpolate", ["linear"], valueExpr(source, period),
    ...rampFor(source).flat(),
  ] as Expr;
  return source === "nasa" ? color : ["case", ["has", "g0"], color, NO_DATA_COLOR];
}

function formatValue(v: number | null, source: Source): string {
  if (v === null) return "Tidak ada data GSA";
  return `${source === "diff" ? formatSigned(v) : v.toFixed(2)} jam/hari`;
}

const whenState = (key: string): maplibregl.ExpressionSpecification =>
  ["case", ["boolean", ["feature-state", key], false], 1, 0];

export default function PshMap({ regions, source, period, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const viewRef = useRef({ source, period });
  const selectedRef = useRef<number | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  onSelectRef.current = onSelect;
  viewRef.current = { source, period };

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
    popupRef.current = popup;
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
      const { source, period } = viewRef.current;
      // Built from DOM nodes: region names come from data, not trusted HTML.
      const content = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = regionName(p);
      const value = document.createElement("strong");
      value.textContent = formatValue(regionValue(p, source, period), source);
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
        popupRef.current?.remove();
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
        paint: {
          "fill-color": fillColor(viewRef.current.source, viewRef.current.period),
          "fill-opacity": 0.85,
        },
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

  // Recolour when the source or month changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("regions-fill")) {
      map.setPaintProperty("regions-fill", "fill-color", fillColor(source, period));
    }
    // Its text was computed for the previous source/month.
    popupRef.current?.remove();
  }, [source, period]);

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

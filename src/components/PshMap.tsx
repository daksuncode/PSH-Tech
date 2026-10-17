import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { PSH_RAMP, gridToGeoJSON, type Period, type PshGrid } from "../lib/psh";

// Free, keyless vector basemap built on OpenStreetMap data.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const INDONESIA_BOUNDS: [[number, number], [number, number]] = [[94, -11.5], [142, 7]];

type Props = {
  grid: PshGrid | null;
  period: Period;
  selected: { lat: number; lon: number } | null;
  onSelect: (lat: number, lon: number) => void;
};

function fillColor(period: Period): maplibregl.ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", `p${period}`],
    ...PSH_RAMP.flat(),
  ] as maplibregl.ExpressionSpecification;
}

export default function PshMap({ grid, period, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const periodRef = useRef(period);
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
    map.on("click", (e) => onSelectRef.current(e.lngLat.lat, e.lngLat.lng));

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    map.on("mousemove", "psh-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "crosshair";
      const v = Number(f.properties?.[`p${periodRef.current}`]);
      popup.setLngLat(e.lngLat).setHTML(`<strong>${v.toFixed(2)}</strong> jam/hari`).addTo(map);
    });
    map.on("mouseleave", "psh-fill", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add or refresh the PSH grid layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !grid) return;
    const data = gridToGeoJSON(grid);
    const apply = () => {
      const source = map.getSource("psh") as GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      // Insert below the first symbol layer so place names stay readable.
      const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addSource("psh", { type: "geojson", data });
      map.addLayer(
        {
          id: "psh-fill",
          type: "fill",
          source: "psh",
          paint: {
            "fill-color": fillColor(periodRef.current),
            "fill-opacity": 0.7,
            "fill-antialias": false,
          },
        },
        firstLabel,
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [grid]);

  // Recolour when the selected month changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("psh-fill")) map.setPaintProperty("psh-fill", "fill-color", fillColor(period));
  }, [period]);

  // Marker for the clicked location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = selected
      ? new maplibregl.Marker({ color: "#843311" }).setLngLat([selected.lon, selected.lat]).addTo(map)
      : null;
  }, [selected]);

  return <div ref={container} className="map" aria-label="Peta Peak Sun Hours Indonesia" />;
}

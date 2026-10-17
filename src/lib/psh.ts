// Peak Sun Hours (PSH) helpers.
//
// PSH = daily solar irradiation on a horizontal surface (kWh/m²/day) divided by
// the 1 kW/m² standard test irradiance, so the number is the same; only the
// unit changes to "hours/day".

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology } from "topojson-specification";
import { feature } from "topojson-client";

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
] as const;

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Period selector: 0 = annual average, 1..12 = month. */
export type Period = number;

/** Climatology for one location: annual mean followed by Jan..Dec. */
export type Climatology = {
  annual: number;
  monthly: number[];
};

/** Administrative level shown on the map. */
export type Level = "kabupaten" | "kecamatan";

export const LEVEL_LABEL: Record<Level, string> = {
  kabupaten: "Kabupaten/Kota",
  kecamatan: "Kecamatan",
};

/**
 * Region properties written by scripts/build-regions.mjs: name, parent names,
 * and PSH as p0 (annual) .. p12 (Dec).
 */
export type RegionProps = {
  id: number;
  n: string;
  kb?: string;
  pr: string;
} & Record<`p${number}`, number>;

export type Regions = FeatureCollection<Polygon | MultiPolygon, RegionProps>;

export function regionClimatology(r: RegionProps): Climatology {
  return {
    annual: r.p0,
    monthly: Array.from({ length: 12 }, (_, i) => r[`p${i + 1}`]),
  };
}

// Source names mark cities with a "Kota " prefix; everything else is a kabupaten.
const regencyLabel = (name: string) => (name.startsWith("Kota ") ? name : `Kab. ${name}`);

/** Display name; kabupaten get "Kab." so "Bandung" isn't confused with "Kota Bandung". */
export function regionName(r: RegionProps): string {
  return r.kb === undefined ? regencyLabel(r.n) : r.n;
}

/** Parent names, e.g. "Kota Bandung, Jawa Barat". */
export function regionParents(r: RegionProps): string {
  return r.kb ? `${regencyLabel(r.kb)}, ${r.pr}` : r.pr;
}

/** Load a level's TopoJSON from public/data and convert it to GeoJSON. */
export async function loadRegions(level: Level): Promise<Regions> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${level}.topo.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const topo = (await res.json()) as Topology;
  return feature(topo, topo.objects.regions) as unknown as Regions;
}

// Single-hue sequential ramp (light -> dark orange): low PSH recedes toward
// the basemap, high PSH reads as the strongest colour. Stops span the bulk of
// NASA POWER monthly values over Indonesia (~3.5-7 h/day; annual ~4.4-6.2).
export const PSH_RAMP: [number, string][] = [
  [3.5, "#fdebdc"],
  [4.0, "#fbcfae"],
  [4.5, "#f7ad7f"],
  [5.0, "#f08a53"],
  [5.5, "#e2662d"],
  [6.0, "#b84b1a"],
  [6.5, "#843311"],
];

export function periodLabel(period: Period): string {
  return period === 0 ? "Rata-rata tahunan" : MONTHS[period - 1];
}

export function periodValue(c: Climatology, period: Period): number {
  return period === 0 ? c.annual : c.monthly[period - 1];
}

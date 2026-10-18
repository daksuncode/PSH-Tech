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

/** Data shown on the map; "diff" is Global Solar Atlas minus NASA POWER. */
export type Source = "nasa" | "gsa" | "diff";

export const SOURCE_LABEL: Record<Source, string> = {
  nasa: "NASA POWER",
  gsa: "Global Solar Atlas",
  diff: "Selisih (GSA − NASA)",
};

/**
 * Region properties written by scripts/build-regions.mjs: name, parent names,
 * NASA POWER PSH as p0 (annual) .. p12 (Dec), and — where Global Solar Atlas
 * has data — GSA GHI g0 (annual PSH) and PVOUT v0 (annual) .. v12 (Dec).
 */
export type RegionProps = {
  id: number;
  n: string;
  kb?: string;
  pr: string;
  g0?: number;
} & Record<`p${number}`, number> & Partial<Record<`v${number}`, number>>;

export type Regions = FeatureCollection<Polygon | MultiPolygon, RegionProps>;

export function nasaClimatology(r: RegionProps): Climatology {
  return {
    annual: r.p0,
    monthly: Array.from({ length: 12 }, (_, i) => r[`p${i + 1}`]),
  };
}

/**
 * GSA publishes monthly values only for PVOUT, so monthly GHI is estimated as
 * annual GHI × (PVOUT that month / PVOUT annual). Null where GSA has no data.
 */
export function gsaClimatology(r: RegionProps): Climatology | null {
  const g0 = r.g0, v0 = r.v0;
  if (g0 === undefined || !v0) return null;
  return {
    annual: g0,
    monthly: Array.from({ length: 12 }, (_, i) => (g0 * (r[`v${i + 1}`] ?? NaN)) / v0),
  };
}

/** GSA PVOUT (kWh/kWp/day): annual then Jan..Dec, or null. */
export function gsaPvout(r: RegionProps): number[] | null {
  const v = Array.from({ length: 13 }, (_, k) => r[`v${k}`]);
  return v.every((x): x is number => x !== undefined) ? v : null;
}

/** The value the map shows for a region, or null when GSA has no data. */
export function regionValue(r: RegionProps, source: Source, period: Period): number | null {
  const nasa = periodValue(nasaClimatology(r), period);
  if (source === "nasa") return nasa;
  const gsa = gsaClimatology(r);
  if (!gsa) return null;
  const g = periodValue(gsa, period);
  return source === "gsa" ? g : g - nasa;
}

/** "+0.12" / "−0.30": signed, with a true minus sign. */
export function formatSigned(v: number, digits = 2): string {
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
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

// Diverging ramp for GSA − NASA: blue where GSA is lower, red where it is
// higher, neutral grey at zero.
export const DIFF_RAMP: [number, string][] = [
  [-0.75, "#184f95"],
  [-0.5, "#3987e5"],
  [-0.25, "#9ec5f4"],
  [0, "#f0efec"],
  [0.25, "#f6b3b0"],
  [0.5, "#e34948"],
  [0.75, "#a32525"],
];

/** Fill for regions without Global Solar Atlas data (tiny islands). */
export const NO_DATA_COLOR = "#c9c7c1";

export const rampFor = (source: Source) => (source === "diff" ? DIFF_RAMP : PSH_RAMP);

export function periodLabel(period: Period): string {
  return period === 0 ? "Rata-rata tahunan" : MONTHS[period - 1];
}

export function periodValue(c: Climatology, period: Period): number {
  return period === 0 ? c.annual : c.monthly[period - 1];
}

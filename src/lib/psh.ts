// Peak Sun Hours (PSH) helpers.
//
// PSH = daily solar irradiation on a horizontal surface (kWh/m²/day) divided by
// the 1 kW/m² standard test irradiance, so the number is the same; only the
// unit changes to "hours/day".

import type { FeatureCollection } from "geojson";

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
] as const;

const POWER_KEYS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Period selector: 0 = annual average, 1..12 = month. */
export type Period = number;

/** Climatology for one location: annual mean followed by Jan..Dec. */
export type Climatology = {
  annual: number;
  monthly: number[];
};

/** Compact grid written by scripts/fetch-psh-grid.mjs. */
export type PshGrid = {
  source: string;
  parameter: string;
  unit: string;
  resolution: number;
  generatedAt: string;
  /** Each row: [lon, lat, annual, jan, ..., dec] (cell centre). */
  points: number[][];
};

// Single-hue sequential ramp (light -> dark orange): low PSH recedes toward
// the basemap, high PSH reads as the strongest colour.
export const PSH_RAMP: [number, string][] = [
  [3.0, "#fdebdc"],
  [3.5, "#fbcfae"],
  [4.0, "#f7ad7f"],
  [4.5, "#f08a53"],
  [5.0, "#e2662d"],
  [5.5, "#b84b1a"],
  [6.0, "#843311"],
];

export function pshColor(value: number): string {
  let color = PSH_RAMP[0][1];
  for (const [stop, hex] of PSH_RAMP) {
    if (value >= stop) color = hex;
  }
  return color;
}

export function periodLabel(period: Period): string {
  return period === 0 ? "Rata-rata tahunan" : MONTHS[period - 1];
}

export function periodValue(c: Climatology, period: Period): number {
  return period === 0 ? c.annual : c.monthly[period - 1];
}

const POWER_POINT_URL =
  "https://power.larc.nasa.gov/api/temporal/climatology/point";

/** Long-term monthly PSH for a point, straight from the NASA POWER API. */
export async function fetchPointClimatology(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<Climatology> {
  const params = new URLSearchParams({
    parameters: "ALLSKY_SFC_SW_DWN",
    community: "RE",
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    format: "JSON",
  });
  const res = await fetch(`${POWER_POINT_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`NASA POWER membalas HTTP ${res.status}`);
  const body = await res.json();
  const values = body?.properties?.parameter?.ALLSKY_SFC_SW_DWN;
  if (!values) throw new Error("Format respons NASA POWER tidak dikenali");
  const monthly = POWER_KEYS.map((k) => Number(values[k]));
  const annual = Number(values.ANN);
  if ([annual, ...monthly].some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error("Data tidak tersedia untuk titik ini");
  }
  return { annual, monthly };
}

/** Nearest grid cell, or null when the point lies outside the grid. */
export function nearestCell(
  grid: PshGrid,
  lat: number,
  lon: number,
): Climatology | null {
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const p of grid.points) {
    const d = (p[0] - lon) ** 2 + (p[1] - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best || Math.sqrt(bestDist) > grid.resolution) return null;
  return { annual: best[2], monthly: best.slice(3, 15) };
}

/** Grid -> GeoJSON squares; properties p0 (annual) .. p12 (Dec). */
export function gridToGeoJSON(grid: PshGrid): FeatureCollection {
  const h = grid.resolution / 2;
  return {
    type: "FeatureCollection",
    features: grid.points.map(([lon, lat, ...values]) => {
      const properties: Record<string, number> = {};
      values.forEach((v, i) => (properties[`p${i}`] = v));
      return {
        type: "Feature",
        properties,
        geometry: {
          type: "Polygon",
          coordinates: [[
            [lon - h, lat - h],
            [lon + h, lat - h],
            [lon + h, lat + h],
            [lon - h, lat + h],
            [lon - h, lat - h],
          ]],
        },
      };
    }),
  };
}

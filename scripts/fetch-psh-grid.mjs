#!/usr/bin/env node
// Download long-term (climatology) solar irradiation for Indonesia from the
// NASA POWER regional API and write a compact grid to public/data/psh-grid.json.
//
// ALLSKY_SFC_SW_DWN is in kWh/m²/day, which equals Peak Sun Hours directly.
// The regional endpoint accepts boxes of at most 10° x 10°, so Indonesia is
// fetched tile by tile.
//
// Usage: npm run data:fetch

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/data/psh-grid.json");
const API = "https://power.larc.nasa.gov/api/temporal/climatology/regional";
const PARAM = "ALLSKY_SFC_SW_DWN";
const KEYS = ["ANN", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Indonesia bounding box (Sabang - Merauke, Miangas - Rote), split into tiles.
const LAT_BANDS = [[-11, -2], [-2, 7]];
const LON_BANDS = [[94, 104], [104, 114], [114, 124], [124, 134], [134, 142]];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(latMin, latMax, lonMin, lonMax) {
  const params = new URLSearchParams({
    parameters: PARAM,
    community: "RE",
    "latitude-min": latMin,
    "latitude-max": latMax,
    "longitude-min": lonMin,
    "longitude-max": lonMax,
    format: "JSON",
  });
  const url = `${API}?${params}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt} (${err.message})`);
      await sleep(2000 * 2 ** attempt);
    }
  }
}

const round = (v) => Math.round(v * 100) / 100;

const cells = new Map();
for (const [latMin, latMax] of LAT_BANDS) {
  for (const [lonMin, lonMax] of LON_BANDS) {
    console.log(`Tile lat ${latMin}..${latMax}, lon ${lonMin}..${lonMax}`);
    const body = await fetchTile(latMin, latMax, lonMin, lonMax);
    for (const f of body.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      const values = f.properties?.parameter?.[PARAM];
      if (!values) continue;
      const row = KEYS.map((k) => Number(values[k]));
      // POWER uses -999 as its fill value.
      if (row.some((v) => !Number.isFinite(v) || v < 0)) continue;
      cells.set(`${lon},${lat}`, [round(lon), round(lat), ...row.map(round)]);
    }
    await sleep(1000); // be polite to the public API
  }
}

if (cells.size === 0) {
  console.error("No data received; nothing written.");
  process.exit(1);
}

const points = [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

// Infer grid spacing from the smallest gap between distinct latitudes.
const lats = [...new Set(points.map((p) => p[1]))].sort((a, b) => a - b);
let resolution = Infinity;
for (let i = 1; i < lats.length; i++) resolution = Math.min(resolution, lats[i] - lats[i - 1]);
if (!Number.isFinite(resolution)) resolution = 0.5;

const grid = {
  source: "NASA POWER (https://power.larc.nasa.gov), climatology",
  parameter: PARAM,
  unit: "kWh/m²/hari (= jam PSH)",
  resolution: round(resolution),
  generatedAt: new Date().toISOString(),
  points,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(grid));
console.log(`Wrote ${points.length} cells (${grid.resolution}°) to ${OUT}`);

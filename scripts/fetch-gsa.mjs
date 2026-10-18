#!/usr/bin/env node
// Download the Global Solar Atlas (GSA 2.0) GIS package for Indonesia and
// extract the rasters used by build-regions.mjs into .cache/gsa/raster:
//   GHI.tif              long-term average daily GHI, kWh/m²/day, 9 arcsec (~280 m)
//   PVOUT.tif            long-term average daily PV output, kWh/kWp/day, 30 arcsec (~1 km)
//   monthly/PVOUT_MM.tif the same per month (GSA publishes monthly values only for PVOUT)
//
// Data © 2019 Solargis, published in the Global Solar Atlas under CC BY 4.0.
// The zip is ~330 MB and is not committed.
//
// Usage: npm run data:gsa

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".cache/gsa");
const ZIP = join(DIR, "gsa.zip");
const URL =
  "https://api.globalsolaratlas.info/download/Indonesia/Indonesia_GISdata_LTAym_AvgDailyTotals_GlobalSolarAtlas-v2_GEOTIFF.zip";

const WANTED = /\/(GHI\.tif|PVOUT\.tif|monthly\/PVOUT_\d\d\.tif)$/;

if (!existsSync(ZIP)) {
  console.log(`Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
  await mkdir(DIR, { recursive: true });
  await writeFile(ZIP, Buffer.from(await res.arrayBuffer()));
}

const files = unzipSync(new Uint8Array(await readFile(ZIP)), {
  filter: (f) => WANTED.test(f.name),
});
for (const [name, data] of Object.entries(files)) {
  const out = join(DIR, "raster", name.match(WANTED)[1]);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, data);
}
console.log(`Extracted ${Object.keys(files).length} rasters to .cache/gsa/raster`);

#!/usr/bin/env node
// Turn the NASA POWER grid (data/psh-grid.json) into per-region Peak Sun Hours
// for kabupaten/kota and kecamatan, clipped to land by the region polygons.
//
// Boundaries: BPS administrative boundaries via OCHA (HDX COD-AB), mirrored by
// geoBoundaries "gbHumanitarian" — CC BY 3.0 IGO.
//
// NASA POWER (p0..p12): the grid bilinearly interpolated at a lattice of sample
// points inside the polygon, averaged. The grid is 1° (~110 km), so
// neighbouring kecamatan often get similar values.
//
// Global Solar Atlas (optional, from npm run data:gsa): mean of the raster
// pixels whose centres fall inside the polygon.
//   g0      GHI, kWh/m²/day (= PSH), 9 arcsec
//   v0..v12 PVOUT, kWh/kWp/day, annual then Jan..Dec, 30 arcsec
// GSA publishes monthly values only for PVOUT; the app estimates monthly GHI
// from g0 and the PVOUT monthly profile.
//
// Usage: npm run data:regions   (run npm run data:fetch, optionally data:gsa, first)

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromFile } from "geotiff";
import mapshaper from "mapshaper";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/boundaries");
const OUT_DIR = join(ROOT, "public/data");
const GSA_DIR = join(ROOT, ".cache/gsa/raster");
const GB_BASE =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbHumanitarian/IDN";

// Douglas-Peucker style tolerance (metres) per level: coarser shapes for the
// zoomed-out kabupaten layer, finer for kecamatan.
const LEVELS = {
  ADM1: { interval: 2000 },
  ADM2: { interval: 500, out: "kabupaten.topo.json" },
  ADM3: { interval: 200, out: "kecamatan.topo.json" },
};

const round2 = (v) => Math.round(v * 100) / 100;

// ---------- grid ----------

const grid = JSON.parse(await readFile(join(ROOT, "data/psh-grid.json"), "utf8"));
const lons = [...new Set(grid.points.map((p) => p[0]))].sort((a, b) => a - b);
const lats = [...new Set(grid.points.map((p) => p[1]))].sort((a, b) => a - b);
const cell = new Map(grid.points.map((p) => [`${p[0]},${p[1]}`, p.slice(2)]));

function bracket(axis, v) {
  if (v <= axis[0]) return [0, 0, 0];
  const last = axis.length - 1;
  if (v >= axis[last]) return [last, last, 0];
  let i = 0;
  while (axis[i + 1] < v) i++;
  return [i, i + 1, (v - axis[i]) / (axis[i + 1] - axis[i])];
}

/** Bilinear interpolation of [annual, jan..dec] at a point (edges clamp). */
function sampleGrid(lon, lat) {
  const [x0, x1, tx] = bracket(lons, lon);
  const [y0, y1, ty] = bracket(lats, lat);
  const c = (xi, yi) => cell.get(`${lons[xi]},${lats[yi]}`);
  const a = c(x0, y0), b = c(x1, y0), d = c(x0, y1), e = c(x1, y1);
  if (!a || !b || !d || !e) return null;
  return a.map((_, k) =>
    (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (d[k] * (1 - tx) + e[k] * tx) * ty,
  );
}

// ---------- geometry ----------

const polygonsOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

function bboxOf(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygonsOf(geometry))
    for (const [x, y] of poly[0]) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  return b;
}

/** Even-odd ray casting over every ring, so holes are handled. */
function contains(geometry, x, y) {
  for (const poly of polygonsOf(geometry)) {
    let inside = false;
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    if (inside) return true;
  }
  return false;
}

/** Sample points inside the polygon on a lattice of ~400 points over its bbox. */
function interiorSamples(geometry, bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  const step = Math.max(0.004, Math.sqrt(((maxX - minX) * (maxY - minY)) / 400));
  const pts = [];
  for (let y = minY + step / 2; y < maxY; y += step)
    for (let x = minX + step / 2; x < maxX; x += step)
      if (contains(geometry, x, y)) pts.push([x, y]);
  if (pts.length === 0) {
    // Very small or thin shape: fall back to the vertex mean of its largest ring.
    const ring = polygonsOf(geometry).map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
    const n = ring.length;
    pts.push([ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]);
  }
  return pts;
}

// ---------- boundaries ----------

async function loadLevel(level) {
  const file = join(CACHE, `IDN-${level}.geojson`);
  if (!existsSync(file)) {
    const url = `${GB_BASE}/${level}/geoBoundaries-IDN-${level}_simplified.geojson`;
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  // Simplify for the web; keep-shapes stops small islands from vanishing.
  const out = await mapshaper.applyCommands(
    `-i in.json -simplify interval=${LEVELS[level].interval} keep-shapes -clean -o out.json precision=0.0001`,
    { "in.json": await readFile(file, "utf8") },
  );
  const features = JSON.parse(out["out.json"]).features.filter((f) => f.geometry);
  return features.map((f) => {
    const bbox = bboxOf(f.geometry);
    const samples = interiorSamples(f.geometry, bbox);
    const values = samples.map(([x, y]) => sampleGrid(x, y)).filter(Boolean);
    const mean = values[0].map((_, k) => values.reduce((s, v) => s + v[k], 0) / values.length);
    // Anchor: the interior sample closest to the samples' centre, used to find the parent.
    const cx = samples.reduce((s, p) => s + p[0], 0) / samples.length;
    const cy = samples.reduce((s, p) => s + p[1], 0) / samples.length;
    const anchor = samples.reduce((best, p) =>
      (p[0] - cx) ** 2 + (p[1] - cy) ** 2 < (best[0] - cx) ** 2 + (best[1] - cy) ** 2 ? p : best,
    );
    // Source names are title-cased, which mangles acronyms ("Dki Jakarta").
    const name = f.properties.shapeName.replace(/^Dki\b/, "DKI");
    return { name, geometry: f.geometry, bbox, mean, anchor };
  });
}

// ---------- rasters (Global Solar Atlas) ----------

async function loadRaster(file) {
  const image = await (await fromFile(file)).getImage();
  const [x0, y0] = image.getOrigin();
  const [res] = image.getResolution();
  const [data] = await image.readRasters();
  return { data, x0, y0, res, width: image.getWidth(), height: image.getHeight() };
}

/**
 * Pixels whose centres fall inside the polygon, as flat [row, col0, col1, ...]
 * triples. Scanline fill with the even-odd rule over every ring (holes too).
 */
function pixelSpans(geometry, bbox, g) {
  const [, minY, , maxY] = bbox;
  const r0 = Math.max(0, Math.floor((g.y0 - maxY) / g.res));
  const r1 = Math.min(g.height - 1, Math.ceil((g.y0 - minY) / g.res));
  if (r1 < r0) return [];
  const rows = Array.from({ length: r1 - r0 + 1 }, () => []);
  for (const poly of polygonsOf(geometry))
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xa, ya] = ring[j], [xb, yb] = ring[i];
        if (ya === yb) continue;
        const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
        const first = Math.max(r0, Math.floor((g.y0 - hi) / g.res - 0.5));
        const last = Math.min(r1, Math.ceil((g.y0 - lo) / g.res - 0.5));
        for (let r = first; r <= last; r++) {
          const yc = g.y0 - (r + 0.5) * g.res;
          // Half-open [lo, hi) so a vertex on a scanline is counted once.
          if (yc >= lo && yc < hi) rows[r - r0].push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
        }
      }
  const spans = [];
  rows.forEach((xs, k) => {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil((xs[i] - g.x0) / g.res - 0.5));
      const c1 = Math.min(g.width - 1, Math.floor((xs[i + 1] - g.x0) / g.res - 0.5));
      if (c0 <= c1) spans.push(r0 + k, c0, c1);
    }
  });
  return spans;
}

/** Mean of valid pixels in the spans; NaN pixels are no-data (sea). */
function zonalMean(raster, spans, anchor) {
  let sum = 0, n = 0;
  for (let k = 0; k < spans.length; k += 3) {
    const base = spans[k] * raster.width;
    for (let c = spans[k + 1]; c <= spans[k + 2]; c++) {
      const v = raster.data[base + c];
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
  }
  if (n) return sum / n;
  // Smaller than a pixel, or only no-data inside: nearest valid pixels around
  // the anchor, searching outwards up to 3 pixels.
  const col = Math.floor((anchor[0] - raster.x0) / raster.res);
  const row = Math.floor((raster.y0 - anchor[1]) / raster.res);
  for (let rad = 0; rad <= 3; rad++) {
    for (let r = row - rad; r <= row + rad; r++)
      for (let c = col - rad; c <= col + rad; c++) {
        if (Math.max(Math.abs(r - row), Math.abs(c - col)) !== rad) continue;
        if (r < 0 || c < 0 || r >= raster.height || c >= raster.width) continue;
        const v = raster.data[r * raster.width + c];
        if (Number.isFinite(v)) {
          sum += v;
          n++;
        }
      }
    if (n) return sum / n;
  }
  return null;
}

/** Adds r.gsa = { ghi, pvout: [annual, jan..dec] } to every region. */
async function addGsa(levels) {
  const all = levels.flat();
  const ghi = await loadRaster(join(GSA_DIR, "GHI.tif"));
  for (const r of all) r.gsa = { ghi: zonalMean(ghi, pixelSpans(r.geometry, r.bbox, ghi), r.anchor) };
  console.log("GSA: GHI done");

  const pvFiles = ["PVOUT.tif", ...Array.from({ length: 12 }, (_, i) => `monthly/PVOUT_${String(i + 1).padStart(2, "0")}.tif`)];
  let spans = null;
  for (const [k, file] of pvFiles.entries()) {
    const pv = await loadRaster(join(GSA_DIR, file));
    // All PVOUT rasters share one grid, so the pixel masks are computed once.
    spans ??= all.map((r) => pixelSpans(r.geometry, r.bbox, pv));
    all.forEach((r, i) => {
      r.gsa.pvout ??= [];
      r.gsa.pvout[k] = zonalMean(pv, spans[i], r.anchor);
    });
  }
  console.log("GSA: PVOUT annual + monthly done");
  const missing = all.filter((r) => r.gsa.ghi === null).length;
  if (missing) console.warn(`GSA: no data for ${missing} regions`);
}

function findParent(parents, [x, y]) {
  const candidates = parents.filter(
    (p) => x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3],
  );
  const hit = candidates.find((p) => contains(p.geometry, x, y));
  if (hit) return hit;
  // Coastline mismatch between levels: take the nearest bbox centre.
  const pool = candidates.length ? candidates : parents;
  const dist = (p) => ((p.bbox[0] + p.bbox[2]) / 2 - x) ** 2 + ((p.bbox[1] + p.bbox[3]) / 2 - y) ** 2;
  return pool.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

function toFeatureCollection(regions, extraProps) {
  return {
    type: "FeatureCollection",
    features: regions.map((r, id) => {
      const properties = { id, n: r.name, ...extraProps(r) };
      r.mean.forEach((v, k) => (properties[`p${k}`] = round2(v)));
      if (r.gsa && r.gsa.ghi !== null && r.gsa.pvout.every((v) => v !== null)) {
        properties.g0 = round2(r.gsa.ghi);
        r.gsa.pvout.forEach((v, k) => (properties[`v${k}`] = round2(v)));
      }
      return { type: "Feature", id, properties, geometry: r.geometry };
    }),
  };
}

const adm1 = await loadLevel("ADM1");
console.log(`ADM1: ${adm1.length} provinsi`);
const adm2 = await loadLevel("ADM2");
for (const r of adm2) r.province = findParent(adm1, r.anchor).name;
console.log(`ADM2: ${adm2.length} kabupaten/kota`);
const adm3 = await loadLevel("ADM3");
for (const r of adm3) {
  const parent = findParent(adm2, r.anchor);
  r.regency = parent.name;
  r.regencyId = adm2.indexOf(parent);
  r.province = parent.province;
}
console.log(`ADM3: ${adm3.length} kecamatan`);

const hasGsa = existsSync(join(GSA_DIR, "GHI.tif"));
if (hasGsa) await addGsa([adm2, adm3]);
else console.warn("GSA rasters not found (run npm run data:gsa); writing NASA values only");
const months = Array.from({ length: 13 }, (_, k) => k);
const valueFields = [
  ...months.map((k) => `p${k}`),
  ...(hasGsa ? ["g0", ...months.map((k) => `v${k}`)] : []),
];

await mkdir(OUT_DIR, { recursive: true });
const outputs = [
  [LEVELS.ADM2.out, toFeatureCollection(adm2, (r) => ({ pr: r.province }))],
  [LEVELS.ADM3.out, toFeatureCollection(adm3, (r) => ({ kb: r.regency, pr: r.province }))],
];
// Geometry-free index for the AI backend (worker/). Kecamatan values are
// sharded per kabupaten so a Worker only parses the slice it needs.
const indexValues = (r) => ({
  p: r.mean.map(round2),
  ...(r.gsa && r.gsa.ghi !== null && r.gsa.pvout.every((v) => v !== null)
    ? { g: round2(r.gsa.ghi), v: r.gsa.pvout.map(round2) }
    : {}),
});
const INDEX_DIR = join(OUT_DIR, "index");
await mkdir(join(INDEX_DIR, "kec"), { recursive: true });
await writeFile(
  join(INDEX_DIR, "kabupaten.json"),
  JSON.stringify(adm2.map((r, id) => ({ id, n: r.name, pr: r.province, ...indexValues(r) }))),
);
// Array position = kecamatan id; each entry is [name, kabupaten id].
await writeFile(join(INDEX_DIR, "kecamatan.json"), JSON.stringify(adm3.map((r) => [r.name, r.regencyId])));
const shards = new Map();
adm3.forEach((r, id) => {
  if (!shards.has(r.regencyId)) shards.set(r.regencyId, []);
  shards.get(r.regencyId).push({ id, n: r.name, ...indexValues(r) });
});
for (const [kabId, rows] of shards) {
  await writeFile(join(INDEX_DIR, "kec", `${kabId}.json`), JSON.stringify(rows));
}
console.log(`Wrote public/data/index (${shards.size} kecamatan shards)`);

for (const [name, fc] of outputs) {
  // TopoJSON stores each shared border once and quantizes coordinates, which
  // makes the kecamatan layer several times smaller than plain GeoJSON.
  const fields = ["id", "n", ...(name === LEVELS.ADM3.out ? ["kb"] : []), "pr", ...valueFields];
  const out = await mapshaper.applyCommands(
    `-i in.json snap -filter-fields ${fields.join(",")} ` +
      "-rename-layers regions -o out.json format=topojson quantization=200000 id-field=id",
    { "in.json": JSON.stringify(fc) },
  );
  const json = out["out.json"].toString();
  await writeFile(join(OUT_DIR, name), json);
  console.log(`Wrote public/data/${name} (${(json.length / 1e6).toFixed(1)} MB)`);
}

#!/usr/bin/env node
// Turn the NASA POWER grid (data/psh-grid.json) into per-region Peak Sun Hours
// for kabupaten/kota and kecamatan, clipped to land by the region polygons.
//
// Boundaries: BPS administrative boundaries via OCHA (HDX COD-AB), mirrored by
// geoBoundaries "gbHumanitarian" — CC BY 3.0 IGO.
//
// Each region's value is the mean of the grid, bilinearly interpolated at a
// lattice of sample points inside the polygon. The grid is 1° (~110 km), so
// neighbouring kecamatan often get similar values.
//
// Usage: npm run data:regions   (run npm run data:fetch first)

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mapshaper from "mapshaper";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/boundaries");
const OUT_DIR = join(ROOT, "public/data");
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
  r.province = parent.province;
}
console.log(`ADM3: ${adm3.length} kecamatan`);

await mkdir(OUT_DIR, { recursive: true });
const outputs = [
  [LEVELS.ADM2.out, toFeatureCollection(adm2, (r) => ({ pr: r.province }))],
  [LEVELS.ADM3.out, toFeatureCollection(adm3, (r) => ({ kb: r.regency, pr: r.province }))],
];
for (const [name, fc] of outputs) {
  // TopoJSON stores each shared border once and quantizes coordinates, which
  // makes the kecamatan layer several times smaller than plain GeoJSON.
  const out = await mapshaper.applyCommands(
    `-i in.json snap -filter-fields ${Object.keys(fc.features[0].properties).join(",")} ` +
      "-rename-layers regions -o out.json format=topojson quantization=200000 id-field=id",
    { "in.json": JSON.stringify(fc) },
  );
  const json = out["out.json"].toString();
  await writeFile(join(OUT_DIR, name), json);
  console.log(`Wrote public/data/${name} (${(json.length / 1e6).toFixed(1)} MB)`);
}

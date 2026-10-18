// Region data for the AI, read from the geometry-free index that
// scripts/build-regions.mjs writes to public/data/index (served as assets).

import { gsaMonthlyEstimate } from "../../shared/gsa";
import type { Level, RegionRef } from "../../shared/protocol";
import type { Env } from "./env";

type Values = { p: number[]; g?: number; v?: number[] };
type KabRow = { id: number; n: string; pr: string } & Values;
type KecRow = { id: number; n: string } & Values;
/** Array position = kecamatan id. */
type KecName = [name: string, kabId: number];

export type RegionSummary = {
  tingkat: Level;
  id: number;
  nama: string;
  kabupaten_kota?: string;
  provinsi: string;
  nasa_power: { psh_tahunan: number; psh_bulanan: number[] };
  global_solar_atlas: {
    psh_tahunan: number;
    psh_bulanan_estimasi: number[];
    pvout_kwh_per_kwp_hari: number;
  } | null;
  selisih_gsa_minus_nasa: number | null;
};

export type RegionMatch = { ref: RegionRef; label: string; score: number };

// Module scope survives across requests within one isolate.
let kabupaten: Promise<KabRow[]> | null = null;
let kecNames: Promise<KecName[]> | null = null;
const shards = new Map<number, Promise<KecRow[]>>();

async function readIndex<T>(env: Env, path: string): Promise<T> {
  const res = await env.ASSETS.fetch(new Request(`https://assets.local/data/index/${path}`));
  // Missing assets fall through to the SPA's index.html, so check the type too.
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
    throw new Error(`region index ${path} not found (run npm run data:regions)`);
  }
  return res.json<T>();
}

function cached<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, load: () => Promise<T>) {
  let p = get();
  if (!p) {
    p = load();
    set(p);
    p.catch(() => set(null)); // retry on the next request instead of caching a failure
  }
  return p;
}

const loadKabupaten = (env: Env) =>
  cached(() => kabupaten, (p) => (kabupaten = p), () => readIndex<KabRow[]>(env, "kabupaten.json"));
const loadKecNames = (env: Env) =>
  cached(() => kecNames, (p) => (kecNames = p), () => readIndex<KecName[]>(env, "kecamatan.json"));
const loadShard = (env: Env, kabId: number) =>
  cached(
    () => shards.get(kabId) ?? null,
    (p) => (p ? shards.set(kabId, p) : shards.delete(kabId)),
    () => readIndex<KecRow[]>(env, `kec/${kabId}.json`),
  );

const r2 = (v: number) => Math.round(v * 100) / 100;

// Source names mark cities with "Kota "; every other ADM2 unit is a kabupaten.
export const regencyLabel = (name: string) => (name.startsWith("Kota ") ? name : `Kab. ${name}`);

function summarize(level: Level, row: KabRow | KecRow, provinsi: string, kab?: string): RegionSummary {
  const gsa =
    row.g !== undefined && row.v
      ? {
          psh_tahunan: row.g,
          psh_bulanan_estimasi: gsaMonthlyEstimate(row.g, row.v).map(r2),
          pvout_kwh_per_kwp_hari: row.v[0],
        }
      : null;
  return {
    tingkat: level,
    id: row.id,
    nama: level === "kabupaten" ? regencyLabel(row.n) : row.n,
    ...(kab ? { kabupaten_kota: regencyLabel(kab) } : {}),
    provinsi,
    nasa_power: { psh_tahunan: row.p[0], psh_bulanan: row.p.slice(1) },
    global_solar_atlas: gsa,
    selisih_gsa_minus_nasa: gsa ? r2(gsa.psh_tahunan - row.p[0]) : null,
  };
}

/** Full data for one region, or null if the id does not exist. */
export async function getRegion(env: Env, ref: RegionRef): Promise<RegionSummary | null> {
  const kabs = await loadKabupaten(env);
  if (ref.level === "kabupaten") {
    const row = kabs[ref.id];
    return row ? summarize("kabupaten", row, row.pr) : null;
  }
  const names = await loadKecNames(env);
  const entry = names[ref.id];
  if (!entry) return null;
  const [, kabId] = entry;
  const row = (await loadShard(env, kabId)).find((k) => k.id === ref.id);
  const kab = kabs[kabId];
  return row && kab ? summarize("kecamatan", row, kab.pr, kab.n) : null;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PREFIX = /^(kabupaten|kab|kota adm|kota administrasi|kota|kecamatan|kec|distrik|provinsi|prov)\s+/;

/** Name without administrative prefixes: "Kab. Bandung" -> "bandung". */
export function coreName(s: string): string {
  let t = normalizeName(s);
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(PREFIX, "");
  }
  return t;
}

function nameScore(candidate: string, query: string): number {
  if (!query) return 0;
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 70;
  if (query.length >= 3 && candidate.includes(query)) return 50;
  const tokens = query.split(" ");
  return tokens.length > 1 && tokens.every((t) => candidate.split(" ").includes(t)) ? 40 : 0;
}

/**
 * Finds regions by name. "Coblong, Bandung" narrows by parent; a leading
 * "Kota"/"Kab." prefers cities or regencies.
 */
export async function searchRegions(env: Env, query: string, level?: Level, limit = 5): Promise<RegionMatch[]> {
  const [namePart, ...context] = query.split(",");
  const q = coreName(namePart);
  const ctx = coreName(context.join(" "));
  const wantsKota = /^\s*kota\b/i.test(namePart);
  const wantsKab = /^\s*(kab|kabupaten)\b/i.test(namePart);
  const contextBonus = (...parents: string[]) =>
    ctx && parents.some((p) => coreName(p).includes(ctx) || ctx.includes(coreName(p))) ? 20 : 0;

  const kabs = await loadKabupaten(env);
  const matches: RegionMatch[] = [];

  if (level !== "kecamatan") {
    for (const k of kabs) {
      let score = nameScore(coreName(k.n), q);
      if (!score) continue;
      const isKota = k.n.startsWith("Kota ");
      if ((wantsKota && isKota) || (wantsKab && !isKota)) score += 15;
      score += contextBonus(k.pr);
      matches.push({ ref: { level: "kabupaten", id: k.id }, label: `${regencyLabel(k.n)}, ${k.pr}`, score: score + 1 });
    }
  }
  if (level !== "kabupaten" && !wantsKota && !wantsKab) {
    const names = await loadKecNames(env);
    names.forEach(([n, kabId], id) => {
      let score = nameScore(coreName(n), q);
      if (!score) return;
      const kab = kabs[kabId];
      score += contextBonus(kab.n, kab.pr);
      matches.push({ ref: { level: "kecamatan", id }, label: `Kec. ${n}, ${regencyLabel(kab.n)}, ${kab.pr}`, score });
    });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Short "Kec. X, Kab. Y, Provinsi" label without loading values. */
export async function regionLabel(env: Env, ref: RegionRef): Promise<string | null> {
  const kabs = await loadKabupaten(env);
  if (ref.level === "kabupaten") {
    const k = kabs[ref.id];
    return k ? `${regencyLabel(k.n)}, ${k.pr}` : null;
  }
  const entry = (await loadKecNames(env))[ref.id];
  if (!entry) return null;
  const kab = kabs[entry[1]];
  return `Kec. ${entry[0]}, ${regencyLabel(kab.n)}, ${kab.pr}`;
}

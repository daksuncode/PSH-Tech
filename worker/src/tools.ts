// Tools the consultation assistant can call. Their inputs are untrusted model
// output: every input is validated before it runs.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Env } from "./env";
import { getRegion, searchRegions } from "./regions";
import { PltsInputError, hitungPlts } from "./solar";

export const TOOL_NAMES = ["cari_wilayah", "hitung_plts"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_LABELS: Record<ToolName, string> = {
  cari_wilayah: "Mencari data wilayah",
  hitung_plts: "Menghitung kebutuhan PLTS",
};

export const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "cari_wilayah",
    description:
      "Cari kabupaten/kota atau kecamatan di Indonesia berdasarkan nama dan kembalikan data Peak Sun Hours-nya " +
      "(rata-rata tahunan dan bulanan) dari NASA POWER dan Global Solar Atlas, plus PVOUT GSA. " +
      "Gunakan setiap kali butuh angka PSH suatu lokasi; jangan pernah menebak angka PSH. " +
      'Untuk nama yang ambigu tambahkan induknya setelah koma, mis. "Coblong, Bandung" atau "Kota Bandung".',
    input_schema: {
      type: "object",
      properties: {
        nama: { type: "string", description: "Nama wilayah, boleh dengan induk setelah koma." },
        tingkat: {
          type: "string",
          enum: ["kabupaten", "kecamatan"],
          description: "Batasi ke satu tingkat wilayah (opsional).",
        },
      },
      required: ["nama"],
    },
    eager_input_streaming: true,
  },
  {
    name: "hitung_plts",
    description:
      "Hitung ukuran dan keekonomian PLTS atap secara pasti: kapasitas kWp, jumlah panel, produksi kWh, " +
      "luas atap, biaya, penghematan, dan balik modal. Selalu pakai alat ini untuk angka-angka tersebut " +
      "alih-alih menghitung sendiri. Isi psh dari hasil cari_wilayah (utamakan Global Solar Atlas bila ada), " +
      "lalu salah satu dari kapasitas_kwp, kebutuhan_kwh_bulan, atau tagihan_rp_bulan.",
    input_schema: {
      type: "object",
      properties: {
        psh: { type: "number", description: "Peak sun hours rata-rata, jam/hari." },
        kapasitas_kwp: { type: "number", description: "Kapasitas sistem yang ingin dihitung, kWp." },
        kebutuhan_kwh_bulan: { type: "number", description: "Pemakaian listrik per bulan, kWh." },
        tagihan_rp_bulan: { type: "number", description: "Tagihan listrik per bulan, Rupiah." },
        tarif_rp_per_kwh: { type: "number", description: "Tarif PLN, Rp/kWh. Default 1444,7 (R-1 1.300–2.200 VA)." },
        biaya_rp_per_kwp: { type: "number", description: "Biaya pemasangan per kWp. Default Rp14 juta." },
        performance_ratio: { type: "number", description: "Rasio kinerja sistem 0,5–0,95. Default 0,8." },
        daya_panel_wp: { type: "number", description: "Daya per panel, Wp. Default 550." },
      },
      required: ["psh"],
    },
    eager_input_streaming: true,
  },
];

const CariWilayah = z.object({
  nama: z.string().trim().min(2).max(120),
  tingkat: z.enum(["kabupaten", "kecamatan"]).optional(),
});

const HitungPlts = z.object({
  psh: z.number().min(1).max(9),
  kapasitas_kwp: z.number().min(0.1).max(1000).optional(),
  kebutuhan_kwh_bulan: z.number().min(1).max(1_000_000).optional(),
  tagihan_rp_bulan: z.number().min(10_000).max(1_000_000_000).optional(),
  tarif_rp_per_kwh: z.number().min(300).max(5000).optional(),
  biaya_rp_per_kwp: z.number().min(1_000_000).max(100_000_000).optional(),
  performance_ratio: z.number().min(0.5).max(0.95).optional(),
  daya_panel_wp: z.number().min(100).max(800).optional(),
});

export type ToolOutcome = { content: string; isError: boolean };

const ok = (value: unknown): ToolOutcome => ({ content: JSON.stringify(value), isError: false });
const fail = (message: string): ToolOutcome => ({ content: JSON.stringify({ error: message }), isError: true });

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export async function runTool(env: Env, name: string, input: unknown): Promise<ToolOutcome> {
  if (name === "cari_wilayah") {
    const parsed = CariWilayah.safeParse(input);
    if (!parsed.success) return fail(`input tidak valid: ${parsed.error.issues[0]?.message ?? "?"}`);
    const matches = await searchRegions(env, parsed.data.nama, parsed.data.tingkat);
    if (matches.length === 0) return ok({ hasil: [], catatan: "Tidak ada wilayah dengan nama itu." });
    // Full values for the best few; the rest as names so the model can disambiguate.
    const detailed = await Promise.all(matches.slice(0, 3).map((m) => getRegion(env, m.ref)));
    return ok({
      hasil: detailed.filter(Boolean),
      alternatif_lain: matches.slice(3).map((m) => m.label),
      catatan:
        "PSH dalam jam/hari. NASA POWER: grid ±110 km. Global Solar Atlas: ±280 m, lebih rinci; " +
        "nilai bulanannya estimasi dari profil PVOUT. null = tidak ada data GSA.",
    });
  }
  if (name === "hitung_plts") {
    const parsed = HitungPlts.safeParse(input);
    if (!parsed.success) return fail(`input tidak valid: ${parsed.error.issues[0]?.message ?? "?"}`);
    const i = parsed.data;
    try {
      return ok(
        hitungPlts({
          psh: i.psh,
          kapasitasKwp: i.kapasitas_kwp,
          kebutuhanKwhBulan: i.kebutuhan_kwh_bulan,
          tagihanRpBulan: i.tagihan_rp_bulan,
          tarifRpPerKwh: i.tarif_rp_per_kwh,
          biayaRpPerKwp: i.biaya_rp_per_kwp,
          performanceRatio: i.performance_ratio,
          dayaPanelWp: i.daya_panel_wp,
        }),
      );
    } catch (err) {
      if (err instanceof PltsInputError) return fail(err.message);
      throw err;
    }
  }
  return fail(`alat tidak dikenal: ${name}`);
}

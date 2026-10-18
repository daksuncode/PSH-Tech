// Deterministic rooftop-PV sizing. The AI calls this as a tool instead of
// doing arithmetic itself, so every number it quotes is reproducible.

import { PLN_TARIFF_R1 } from "../../shared/tariff";

export const DAYS_PER_MONTH = 365 / 12;

export const DEFAULTS = {
  tarifRpPerKwh: PLN_TARIFF_R1,
  // Typical installed cost of a rooftop system in Indonesia, Rp per kWp.
  biayaRpPerKwp: 14_000_000,
  performanceRatio: 0.8,
  dayaPanelWp: 550,
  // Roof area per 550 Wp panel including spacing, m².
  luasPerPanelM2: 2.6,
} as const;

export type PltsInput = {
  /** Peak sun hours, h/day (= kWh/m²/day). */
  psh: number;
  kebutuhanKwhBulan?: number;
  kapasitasKwp?: number;
  tagihanRpBulan?: number;
  tarifRpPerKwh?: number;
  biayaRpPerKwp?: number;
  performanceRatio?: number;
  dayaPanelWp?: number;
};

export type PltsResult = {
  kebutuhan_kwh_bulan: number | null;
  kapasitas_kwp_dibutuhkan: number;
  jumlah_panel: number;
  kapasitas_kwp_terpasang: number;
  produksi_kwh_hari: number;
  produksi_kwh_bulan: number;
  produksi_kwh_tahun: number;
  porsi_kebutuhan_tertutup_persen: number | null;
  luas_atap_m2: number;
  biaya_investasi_rp: number;
  penghematan_rp_tahun: number;
  balik_modal_tahun: number | null;
  asumsi: string[];
};

const r = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

export class PltsInputError extends Error {}

export function hitungPlts(input: PltsInput): PltsResult {
  const tarif = input.tarifRpPerKwh ?? DEFAULTS.tarifRpPerKwh;
  const biayaPerKwp = input.biayaRpPerKwp ?? DEFAULTS.biayaRpPerKwp;
  const pr = input.performanceRatio ?? DEFAULTS.performanceRatio;
  const wp = input.dayaPanelWp ?? DEFAULTS.dayaPanelWp;

  const kebutuhan =
    input.kebutuhanKwhBulan ?? (input.tagihanRpBulan !== undefined ? input.tagihanRpBulan / tarif : null);
  const kwpPerKwhBulan = 1 / (input.psh * pr * DAYS_PER_MONTH);
  const kwpTarget = input.kapasitasKwp ?? (kebutuhan !== null ? kebutuhan * kwpPerKwhBulan : null);
  if (kwpTarget === null) {
    throw new PltsInputError("Isi salah satu: kapasitas_kwp, kebutuhan_kwh_bulan, atau tagihan_rp_bulan.");
  }

  const panels = Math.max(1, Math.ceil((kwpTarget * 1000) / wp - 1e-9));
  const kwp = (panels * wp) / 1000;
  const daily = input.psh * kwp * pr;
  const monthly = daily * DAYS_PER_MONTH;
  const cost = kwp * biayaPerKwp;
  // Exported surplus no longer reduces the PLN bill (Permen ESDM 2/2024), so
  // only energy used on site counts as savings.
  const usedMonthly = kebutuhan !== null ? Math.min(monthly, kebutuhan) : monthly;
  const savingsYear = usedMonthly * 12 * tarif;

  return {
    kebutuhan_kwh_bulan: kebutuhan !== null ? r(kebutuhan, 0) : null,
    kapasitas_kwp_dibutuhkan: r(kwpTarget),
    jumlah_panel: panels,
    kapasitas_kwp_terpasang: r(kwp),
    produksi_kwh_hari: r(daily, 1),
    produksi_kwh_bulan: r(monthly, 0),
    produksi_kwh_tahun: r(daily * 365, 0),
    porsi_kebutuhan_tertutup_persen: kebutuhan ? r(Math.min(100, (monthly / kebutuhan) * 100), 0) : null,
    luas_atap_m2: r(panels * DEFAULTS.luasPerPanelM2, 1),
    biaya_investasi_rp: Math.round(cost / 100_000) * 100_000,
    penghematan_rp_tahun: Math.round(savingsYear / 10_000) * 10_000,
    balik_modal_tahun: savingsYear > 0 ? r(cost / savingsYear, 1) : null,
    asumsi: [
      `PSH ${input.psh} jam/hari, performance ratio ${pr}`,
      `panel ${wp} Wp, ±${DEFAULTS.luasPerPanelM2} m² atap per panel`,
      `tarif PLN Rp${tarif.toLocaleString("id-ID")}/kWh`,
      `biaya pemasangan Rp${biayaPerKwp.toLocaleString("id-ID")}/kWp`,
      "penghematan hanya dari listrik yang dipakai sendiri; kelebihan yang diekspor ke PLN tidak mengurangi tagihan (Permen ESDM 2/2024)",
    ],
  };
}

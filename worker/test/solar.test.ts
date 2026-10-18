import { describe, expect, it } from "vitest";
import { DAYS_PER_MONTH, PltsInputError, hitungPlts } from "../src/solar";

describe("hitungPlts", () => {
  it("sizes a system from monthly kWh and rounds up to whole panels", () => {
    const r = hitungPlts({ psh: 4.5, kebutuhanKwhBulan: 300 });
    const kwp = 300 / (4.5 * 0.8 * DAYS_PER_MONTH);
    expect(r.kapasitas_kwp_dibutuhkan).toBeCloseTo(kwp, 2);
    expect(r.jumlah_panel).toBe(Math.ceil((kwp * 1000) / 550));
    expect(r.kapasitas_kwp_terpasang).toBeCloseTo((r.jumlah_panel * 550) / 1000, 5);
    expect(r.produksi_kwh_bulan).toBeGreaterThanOrEqual(300);
    expect(r.porsi_kebutuhan_tertutup_persen).toBe(100);
  });

  it("derives kWh from a bill with the default tariff", () => {
    const r = hitungPlts({ psh: 5, tagihanRpBulan: 1_444_700 });
    expect(r.kebutuhan_kwh_bulan).toBe(1000);
  });

  it("counts only self-consumed energy as savings", () => {
    // 10 kWp produces far more than 100 kWh/month; savings cap at the demand.
    const r = hitungPlts({ psh: 5, kapasitasKwp: 10, kebutuhanKwhBulan: 100 });
    expect(r.penghematan_rp_tahun).toBe(Math.round((100 * 12 * 1444.7) / 10_000) * 10_000);
    expect(r.porsi_kebutuhan_tertutup_persen).toBe(100);
  });

  it("computes payback from cost and savings", () => {
    const r = hitungPlts({ psh: 4, kapasitasKwp: 1.1 });
    const cost = 1.1 * 14_000_000;
    const savings = 4 * 1.1 * 0.8 * DAYS_PER_MONTH * 12 * 1444.7;
    expect(r.balik_modal_tahun).toBeCloseTo(cost / savings, 1);
  });

  it("rejects input without capacity, demand or bill", () => {
    expect(() => hitungPlts({ psh: 5 })).toThrow(PltsInputError);
  });
});

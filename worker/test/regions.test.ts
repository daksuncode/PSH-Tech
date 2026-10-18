import { describe, expect, it } from "vitest";
import { gsaMonthlyEstimate } from "../../shared/gsa";
import { coreName, getRegion, regionLabel, searchRegions } from "../src/regions";
import { runTool } from "../src/tools";
import { testEnv } from "./helpers";

const env = testEnv();

describe("coreName", () => {
  it("strips administrative prefixes and punctuation", () => {
    expect(coreName("Kab. Bandung")).toBe("bandung");
    expect(coreName("Kota Adm. Jakarta Pusat")).toBe("jakarta pusat");
    expect(coreName("Kecamatan  Coblong")).toBe("coblong");
  });
});

describe("searchRegions", () => {
  it("finds a kecamatan with its parents", async () => {
    const [top] = await searchRegions(env, "Coblong");
    expect(top.label).toBe("Kec. Coblong, Kota Bandung, Jawa Barat");
    expect(top.ref.level).toBe("kecamatan");
  });

  it("prefers the city for a Kota prefix and returns both for a bare name", async () => {
    expect((await searchRegions(env, "Kota Bandung"))[0].label).toBe("Kota Bandung, Jawa Barat");
    const labels = (await searchRegions(env, "Bandung", "kabupaten")).map((m) => m.label);
    expect(labels).toContain("Kab. Bandung, Jawa Barat");
    expect(labels).toContain("Kota Bandung, Jawa Barat");
  });

  it("uses text after a comma to pick among duplicate names", async () => {
    const [top] = await searchRegions(env, "Karanganyar, Demak");
    expect(top.label).toContain("Demak");
  });

  it("returns nothing for unknown names", async () => {
    expect(await searchRegions(env, "Atlantis")).toEqual([]);
  });
});

describe("getRegion", () => {
  it("returns NASA and GSA values with the GSA monthly estimate", async () => {
    const [top] = await searchRegions(env, "Menteng, Jakarta Pusat");
    const r = await getRegion(env, top.ref);
    expect(r?.kabupaten_kota).toBe("Kota Jakarta Pusat");
    expect(r?.provinsi).toBe("DKI Jakarta");
    expect(r?.nasa_power.psh_bulanan).toHaveLength(12);
    expect(r?.global_solar_atlas?.psh_tahunan).toBeGreaterThan(3);
    expect(r?.selisih_gsa_minus_nasa).toBeCloseTo(r!.global_solar_atlas!.psh_tahunan - r!.nasa_power.psh_tahunan, 2);
  });

  it("reports missing GSA data as null", async () => {
    const [top] = await searchRegions(env, "Kepulauan Seribu", "kabupaten");
    const r = await getRegion(env, top.ref);
    expect(r?.global_solar_atlas).toBeNull();
    expect(r?.selisih_gsa_minus_nasa).toBeNull();
  });

  it("returns null for ids that do not exist", async () => {
    expect(await getRegion(env, { level: "kecamatan", id: 999_999 })).toBeNull();
    expect(await regionLabel(env, { level: "kabupaten", id: 999_999 })).toBeNull();
  });
});

describe("gsaMonthlyEstimate", () => {
  it("keeps the day-weighted annual mean equal to the annual GHI", () => {
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const pvout = [4, 3.5, 3.6, 4, 4.2, 4.3, 4.1, 4.2, 4.5, 4.6, 4.3, 3.8, 3.4];
    pvout[0] = days.reduce((s, d, i) => s + d * pvout[i + 1], 0) / 365;
    const months = gsaMonthlyEstimate(5, pvout);
    expect(days.reduce((s, d, i) => s + d * months[i], 0) / 365).toBeCloseTo(5, 10);
  });
});

describe("runTool", () => {
  it("validates input before running", async () => {
    const out = await runTool(env, "hitung_plts", { psh: 50 });
    expect(out.isError).toBe(true);
    const unknown = await runTool(env, "hapus_semua", {});
    expect(unknown.isError).toBe(true);
  });

  it("returns region data for cari_wilayah", async () => {
    const out = await runTool(env, "cari_wilayah", { nama: "Kupang", tingkat: "kabupaten" });
    const body = JSON.parse(out.content);
    expect(out.isError).toBe(false);
    expect(body.hasil[0].nama).toMatch(/Kupang/);
    expect(body.hasil[0].nasa_power.psh_tahunan).toBeGreaterThan(5);
  });
});

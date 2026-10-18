import { useRef, useState, type ChangeEvent } from "react";
import type { BillReading } from "../../shared/protocol";
import { PLN_TARIFF_R1 } from "../../shared/tariff";
import { readBillPhoto } from "../lib/ai";
import { DAYS_IN_MONTH, type Climatology } from "../lib/psh";

const fmt = (v: number, digits = 0) =>
  v.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });

type Props = {
  data: Climatology;
  sourceLabel: string;
  /** GSA PVOUT (kWh/kWp/day), annual then Jan..Dec, when available. */
  pvout?: number[] | null;
  /** Show the "read my PLN bill" upload (needs the AI backend). */
  billReader?: boolean;
};

/** Monthly kWh from a reading: the kWh figure, else the bill amount at the R-1 tariff. */
function kwhFromReading(r: BillReading): { kwh: number; estimated: boolean } | null {
  if (r.pemakaian_kwh && r.pemakaian_kwh > 0) return { kwh: Math.round(r.pemakaian_kwh), estimated: false };
  if (r.total_tagihan_rp && r.total_tagihan_rp > 0) {
    return { kwh: Math.round(r.total_tagihan_rp / PLN_TARIFF_R1), estimated: true };
  }
  return null;
}

function BillUpload({ onKwh }: { onKwh: (kwh: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const reading = await readBillPhoto(file);
      const usage = reading.terbaca ? kwhFromReading(reading) : null;
      if (!usage) {
        setStatus({ text: reading.catatan || "Pemakaian kWh tidak terbaca dari foto ini.", error: true });
        return;
      }
      onKwh(usage.kwh);
      const details = [
        reading.periode,
        reading.daya_va ? `${fmt(reading.daya_va)} VA` : null,
        reading.golongan_tarif,
      ].filter(Boolean);
      setStatus({
        text:
          `Terbaca ${fmt(usage.kwh)} kWh${details.length ? ` (${details.join(", ")})` : ""}` +
          (usage.estimated ? `, dihitung dari total tagihan dengan tarif Rp${fmt(PLN_TARIFF_R1, 1)}/kWh` : "") +
          ".",
        error: false,
      });
    } catch (err) {
      setStatus({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bill-upload">
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
      <button type="button" className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Membaca tagihan…" : "Isi dari foto tagihan PLN"}
      </button>
      {status && <p className={status.error ? "ai-error" : "hint"}>{status.text}</p>}
      <p className="muted small">Foto hanya dikirim untuk dibaca AI dan tidak disimpan.</p>
    </div>
  );
}

/**
 * Rough PV yield: energy = PSH × kWp × performance ratio.
 * The performance ratio lumps together inverter, temperature, soiling and
 * wiring losses; 0.75-0.8 is typical for rooftop systems in the tropics.
 * GSA's PVOUT already includes its own loss model, so it is shown as an
 * independent cross-check that ignores the PR field.
 */
export default function Calculator({ data, sourceLabel, pvout, billReader }: Props) {
  const [kwp, setKwp] = useState(3);
  const [pr, setPr] = useState(0.8);
  const [target, setTarget] = useState(300);

  const daily = data.annual * kwp * pr;
  const yearly = data.monthly.reduce((sum, psh, i) => sum + psh * DAYS_IN_MONTH[i], 0) * kwp * pr;
  const worst = Math.min(...data.monthly) * kwp * pr * 30;
  const neededKwp = target / (data.annual * pr * 30.4);
  const pvoutYearly = pvout && pvout.slice(1).reduce((sum, v, i) => sum + v * DAYS_IN_MONTH[i], 0) * kwp;

  return (
    <section className="calc">
      <h3>Kalkulator PLTS</h3>
      <p className="hint muted">Berdasarkan PSH {sourceLabel}.</p>
      <div className="fields">
        <label>
          Kapasitas (kWp)
          <input type="number" min={0.1} step={0.1} value={kwp}
            onChange={(e) => setKwp(Number(e.target.value) || 0)} />
        </label>
        <label>
          Performance ratio
          <input type="number" min={0.5} max={1} step={0.01} value={pr}
            onChange={(e) => setPr(Number(e.target.value) || 0)} />
        </label>
      </div>
      <dl className="stats">
        <div><dt>Per hari</dt><dd>{fmt(daily, 1)} kWh</dd></div>
        <div><dt>Per tahun</dt><dd>{fmt(yearly)} kWh</dd></div>
        <div><dt>Bulan terendah</dt><dd>{fmt(worst)} kWh</dd></div>
      </dl>
      {pvoutYearly != null && (
        <p className="hint">
          Pembanding dari PVOUT Global Solar Atlas (model rugi-rugi GSA, tanpa PR di atas):{" "}
          <strong>{fmt(pvoutYearly)} kWh/tahun</strong>.
        </p>
      )}
      {billReader && <BillUpload onKwh={setTarget} />}
      <label className="inverse">
        Kebutuhan listrik (kWh/bulan)
        <input type="number" min={0} step={10} value={target}
          onChange={(e) => setTarget(Number(e.target.value) || 0)} />
      </label>
      <p className="hint">
        Butuh sekitar <strong>{fmt(neededKwp, 2)} kWp</strong> panel untuk menutup{" "}
        {fmt(target)} kWh/bulan.
      </p>
    </section>
  );
}

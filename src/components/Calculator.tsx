import { useState } from "react";
import { DAYS_IN_MONTH, type Climatology } from "../lib/psh";

const fmt = (v: number, digits = 0) =>
  v.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/**
 * Rough PV yield: energy = PSH × kWp × performance ratio.
 * The performance ratio lumps together inverter, temperature, soiling and
 * wiring losses; 0.75-0.8 is typical for rooftop systems in the tropics.
 */
export default function Calculator({ data }: { data: Climatology }) {
  const [kwp, setKwp] = useState(3);
  const [pr, setPr] = useState(0.8);
  const [target, setTarget] = useState(300);

  const daily = data.annual * kwp * pr;
  const yearly = data.monthly.reduce((sum, psh, i) => sum + psh * DAYS_IN_MONTH[i], 0) * kwp * pr;
  const worst = Math.min(...data.monthly) * kwp * pr * 30;
  const neededKwp = target / (data.annual * pr * 30.4);

  return (
    <section className="calc">
      <h3>Kalkulator PLTS</h3>
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

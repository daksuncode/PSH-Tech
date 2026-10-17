import { Suspense, lazy, useEffect, useState } from "react";
import Calculator from "./Calculator";
import MonthlyChart from "./MonthlyChart";
import {
  LEVEL_LABEL, MONTHS, PSH_RAMP, loadRegions, periodLabel, periodValue,
  regionClimatology, regionName, regionParents,
  type Level, type Period, type RegionProps, type Regions,
} from "../lib/psh";

// MapLibre is the heaviest dependency; load it in its own chunk.
const PshMap = lazy(() => import("./PshMap"));

const LEVELS: Level[] = ["kabupaten", "kecamatan"];

export default function PshExplorer() {
  const [level, setLevel] = useState<Level>("kabupaten");
  const [regions, setRegions] = useState<Regions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>(0);
  const [selected, setSelected] = useState<RegionProps | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSelected(null);
    loadRegions(level)
      .then((data) => !cancelled && setRegions(data))
      .catch((err: Error) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [level]);

  const data = selected && regionClimatology(selected);

  return (
    <div className="layout">
      <div className="map-wrap">
        <Suspense fallback={<div className="map map-loading">Memuat peta…</div>}>
          <PshMap
            regions={regions}
            period={period}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
        </Suspense>
        {loading && <div className="map-status">Memuat data {LEVEL_LABEL[level].toLowerCase()}…</div>}
        <div className="legend" aria-label="Legenda PSH">
          <span className="legend-title">PSH (jam/hari) · {periodLabel(period)}</span>
          <div className="legend-ramp">
            {PSH_RAMP.map(([stop, color]) => (
              <span key={stop} style={{ background: color }} />
            ))}
          </div>
          <div className="legend-ticks">
            {PSH_RAMP.map(([stop]) => <span key={stop}>{stop}</span>)}
          </div>
        </div>
      </div>

      <aside className="panel">
        <header>
          <h1>Peta Peak Sun Hours Indonesia</h1>
          <p className="muted">
            Rata-rata jangka panjang radiasi matahari harian (kWh/m²/hari = jam PSH)
            per wilayah, dari data satelit NASA POWER.
          </p>
        </header>

        <div className="controls">
          <div className="segmented" role="group" aria-label="Tingkat wilayah">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
              >
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
          <label className="period">
            Periode
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              <option value={0}>Rata-rata tahunan</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        {loadError && <p className="notice">Gagal memuat data wilayah: {loadError}</p>}

        {!selected && !loadError && (
          <p className="muted">Klik {LEVEL_LABEL[level].toLowerCase()} di peta untuk melihat detailnya.</p>
        )}
        {selected && data && (
          <>
            <section className="hero">
              <h2>{regionName(selected)}</h2>
              <span className="muted">{regionParents(selected)}</span>
              <span className="hero-value">
                {periodValue(data, period).toFixed(2)}
                <small> jam/hari</small>
              </span>
              <span className="muted">{periodLabel(period)}</span>
            </section>
            <MonthlyChart data={data} period={period} />
            <Calculator data={data} />
          </>
        )}

        <footer className="muted small">
          <p>
            Nilai wilayah = rata-rata grid NASA POWER 1° (±110 km) yang diinterpolasi ke dalam
            batas wilayah, jadi wilayah yang berdekatan bisa bernilai mirip.
          </p>
          <p>
            Data: <a href="https://power.larc.nasa.gov" target="_blank" rel="noreferrer">NASA POWER</a>
            {" · "}Batas wilayah: BPS via{" "}
            <a href="https://data.humdata.org/dataset/cod-ab-idn" target="_blank" rel="noreferrer">OCHA HDX</a>
            {" / "}
            <a href="https://www.geoboundaries.org" target="_blank" rel="noreferrer">geoBoundaries</a>
            {" "}(CC BY 3.0 IGO)
            {" · "}Peta: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{" "}
            © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
          </p>
        </footer>
      </aside>
    </div>
  );
}

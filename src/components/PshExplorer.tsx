import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import Calculator from "./Calculator";
import MonthlyChart from "./MonthlyChart";
import {
  MONTHS, PSH_RAMP, fetchPointClimatology, nearestCell, periodLabel, periodValue,
  type Climatology, type Period, type PshGrid,
} from "../lib/psh";

// MapLibre is the heaviest dependency; load it in its own chunk.
const PshMap = lazy(() => import("./PshMap"));

type PointState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: Climatology; source: "live" | "grid" }
  | { status: "error"; message: string };

export default function PshExplorer() {
  const [grid, setGrid] = useState<PshGrid | null>(null);
  const [gridMissing, setGridMissing] = useState(false);
  const [period, setPeriod] = useState<Period>(0);
  const [selected, setSelected] = useState<{ lat: number; lon: number } | null>(null);
  const [point, setPoint] = useState<PointState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/psh-grid.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setGrid)
      .catch(() => setGridMissing(true));
  }, []);

  const onSelect = useCallback(
    async (lat: number, lon: number) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSelected({ lat, lon });
      setPoint({ status: "loading" });
      try {
        const data = await fetchPointClimatology(lat, lon, ctrl.signal);
        setPoint({ status: "ok", data, source: "live" });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const cell = grid && nearestCell(grid, lat, lon);
        setPoint(
          cell
            ? { status: "ok", data: cell, source: "grid" }
            : { status: "error", message: (err as Error).message },
        );
      }
    },
    [grid],
  );

  return (
    <div className="layout">
      <div className="map-wrap">
        <Suspense fallback={<div className="map map-loading">Memuat peta…</div>}>
          <PshMap grid={grid} period={period} selected={selected} onSelect={onSelect} />
        </Suspense>
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
            dari data satelit NASA POWER.
          </p>
        </header>

        <label className="period">
          Periode
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            <option value={0}>Rata-rata tahunan</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>

        {gridMissing && (
          <p className="notice">
            Layer grid belum tersedia. Jalankan <code>npm run data:fetch</code> untuk
            membuat <code>public/data/psh-grid.json</code>. Klik peta tetap bisa
            dipakai (data diambil langsung dari NASA POWER).
          </p>
        )}

        {point.status === "idle" && <p className="muted">Klik lokasi mana saja di peta.</p>}
        {point.status === "loading" && <p className="muted">Mengambil data…</p>}
        {point.status === "error" && <p className="notice">Gagal memuat data: {point.message}</p>}
        {point.status === "ok" && selected && (
          <>
            <section className="hero">
              <span className="muted">
                {selected.lat.toFixed(3)}, {selected.lon.toFixed(3)}
                {point.source === "grid" && " · dari sel grid terdekat"}
              </span>
              <span className="hero-value">
                {periodValue(point.data, period).toFixed(2)}
                <small> jam/hari</small>
              </span>
              <span className="muted">{periodLabel(period)}</span>
            </section>
            <MonthlyChart data={point.data} period={period} />
            <Calculator data={point.data} />
          </>
        )}

        <footer className="muted small">
          Data: <a href="https://power.larc.nasa.gov" target="_blank" rel="noreferrer">NASA POWER</a>{" "}
          · Peta: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{" "}
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        </footer>
      </aside>
    </div>
  );
}

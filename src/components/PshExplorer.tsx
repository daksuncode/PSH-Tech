import { Suspense, lazy, useEffect, useState } from "react";
import { useAiAvailable } from "../lib/ai";
import Calculator from "./Calculator";
import ExplainCard from "./ExplainCard";
import MonthlyChart, { type Series } from "./MonthlyChart";
import {
  LEVEL_LABEL, MONTHS, NO_DATA_COLOR, SOURCE_LABEL, formatSigned, gsaClimatology, gsaPvout,
  loadRegions, nasaClimatology, periodLabel, periodValue, rampFor, regionName, regionParents,
  regionValue,
  type Level, type Period, type RegionProps, type Regions, type Source,
} from "../lib/psh";

// MapLibre is the heaviest dependency; load it in its own chunk.
const PshMap = lazy(() => import("./PshMap"));
// Chat (and its markdown renderer) loads only when the drawer is opened.
const AiChat = lazy(() => import("./AiChat"));

const LEVELS: Level[] = ["kabupaten", "kecamatan"];
const SOURCES: Source[] = ["nasa", "gsa", "diff"];
const GSA_MONTHLY_NOTE = "GSA bulanan = estimasi dari GHI tahunan × profil PVOUT bulanan GSA.";

export default function PshExplorer() {
  const [level, setLevel] = useState<Level>("kabupaten");
  const [regions, setRegions] = useState<Regions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>(0);
  const [source, setSource] = useState<Source>("nasa");
  const [chatOpen, setChatOpen] = useState(false);
  const aiAvailable = useAiAvailable();
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

  const gsaAvailable = !!regions?.features.some((f) => f.properties.g0 !== undefined);
  const nasa = selected && nasaClimatology(selected);
  const gsa = selected && gsaClimatology(selected);
  const value = selected && regionValue(selected, source, period);
  // The calculator follows the chosen source; "diff" uses the finer GSA data.
  const calcData = source === "nasa" ? nasa : gsa ?? nasa;
  const series: Series[] = [
    ...(nasa ? [{ key: "nasa", label: SOURCE_LABEL.nasa, data: nasa }] : []),
    ...(gsa ? [{ key: "gsa", label: SOURCE_LABEL.gsa, data: gsa }] : []),
  ];
  const ramp = rampFor(source);

  return (
    <div className="layout">
      <div className="map-wrap">
        <Suspense fallback={<div className="map map-loading">Memuat peta…</div>}>
          <PshMap
            regions={regions}
            source={source}
            period={period}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
        </Suspense>
        {loading && <div className="map-status">Memuat data {LEVEL_LABEL[level].toLowerCase()}…</div>}
        <div className="legend" aria-label="Legenda PSH">
          <span className="legend-title">
            {source === "diff" ? "Selisih GSA − NASA (jam/hari)" : `PSH (jam/hari) · ${SOURCE_LABEL[source]}`}
            {" · "}{periodLabel(period)}
          </span>
          <div className="legend-ramp">
            {ramp.map(([stop, color]) => (
              <span key={stop} style={{ background: color }} />
            ))}
          </div>
          <div className="legend-ticks">
            {ramp.map(([stop]) => (
              <span key={stop}>{source === "diff" && stop !== 0 ? `${stop > 0 ? "+" : "−"}${Math.abs(stop)}` : stop}</span>
            ))}
          </div>
          {source !== "nasa" && (
            <div className="legend-nodata">
              <i style={{ background: NO_DATA_COLOR }} /> Tidak ada data GSA
            </div>
          )}
        </div>
      </div>

      <aside className="panel">
        {chatOpen && (
          <Suspense fallback={<div className="ai-chat" />}>
            <AiChat
              region={selected ? { level, id: selected.id } : null}
              regionName={selected ? `${regionName(selected)}, ${regionParents(selected)}` : null}
              onClose={() => setChatOpen(false)}
            />
          </Suspense>
        )}
        <header>
          <h1>Peta Peak Sun Hours Indonesia</h1>
          <p className="muted">
            Rata-rata jangka panjang radiasi matahari harian (kWh/m²/hari = jam PSH)
            per wilayah, dari NASA POWER dan Global Solar Atlas.
          </p>
          {aiAvailable && (
            <button type="button" className="ai-open" onClick={() => setChatOpen(true)}>
              Tanya asisten AI
            </button>
          )}
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
          <label>
            Sumber data
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              {SOURCES.map((s) => (
                <option key={s} value={s} disabled={s !== "nasa" && !gsaAvailable}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
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
        {selected && nasa && calcData && (
          <>
            <section className="hero">
              <h2>{regionName(selected)}</h2>
              <span className="muted">{regionParents(selected)}</span>
              <span className="hero-value">
                {value === null ? "—" : source === "diff" ? formatSigned(value) : value.toFixed(2)}
                <small> jam/hari</small>
              </span>
              <span className="muted">
                {SOURCE_LABEL[source]} · {periodLabel(period)}
                {value === null && " · tidak ada data GSA untuk wilayah ini"}
              </span>
            </section>
            {gsa && (
              <dl className="stats compare">
                <div>
                  <dt>NASA POWER</dt>
                  <dd>{periodValue(nasa, period).toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Global Solar Atlas</dt>
                  <dd>{periodValue(gsa, period).toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Selisih</dt>
                  <dd>
                    {formatSigned(periodValue(gsa, period) - periodValue(nasa, period))}
                    <small>
                      {" "}({formatSigned(
                        ((periodValue(gsa, period) - periodValue(nasa, period)) / periodValue(nasa, period)) * 100,
                        0,
                      )}%)
                    </small>
                  </dd>
                </div>
              </dl>
            )}
            {aiAvailable && <ExplainCard region={{ level, id: selected.id }} source={source} period={period} />}
            <MonthlyChart series={series} period={period} note={gsa ? GSA_MONTHLY_NOTE : undefined} />
            <Calculator
              data={calcData}
              sourceLabel={source === "nasa" || !gsa ? SOURCE_LABEL.nasa : SOURCE_LABEL.gsa}
              pvout={gsaPvout(selected)}
              billReader={aiAvailable}
            />
          </>
        )}

        <footer className="muted small">
          <p>
            NASA POWER: grid 1° (±110 km) yang diinterpolasi ke dalam batas wilayah, jadi wilayah
            yang berdekatan bisa bernilai mirip. Global Solar Atlas: rata-rata piksel ±280 m (GHI)
            di dalam batas wilayah.
          </p>
          <p>
            Data: <a href="https://power.larc.nasa.gov" target="_blank" rel="noreferrer">NASA POWER</a>
            {" · "}
            <a href="https://globalsolaratlas.info" target="_blank" rel="noreferrer">Global Solar Atlas 2.0</a>
            {" "}© 2019 Solargis (CC BY 4.0)
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

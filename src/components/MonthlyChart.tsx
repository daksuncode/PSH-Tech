import { useState } from "react";
import { MONTHS, type Climatology, type Period } from "../lib/psh";

const W = 320;
const H = 160;
const PAD = { top: 10, right: 4, bottom: 20, left: 26 };
const GROUP_GAP = 4;
const BAR_GAP = 2;

export type Series = {
  key: string;
  label: string;
  data: Climatology;
};

type Props = {
  series: Series[];
  period: Period;
  note?: string;
};

/** Monthly PSH as grouped bars (one bar per series), with hover and a table view. */
export default function MonthlyChart({ series, period, note }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.data.monthly);
  const max = Math.max(7, Math.ceil(Math.max(...all)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / 12;
  const barW = (slot - GROUP_GAP - BAR_GAP * (series.length - 1)) / series.length;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.floor(max / 2) + 1 }, (_, i) => i * 2);
  const single = series.length === 1 ? series[0].data.monthly : null;
  const hi = single && single.indexOf(Math.max(...single));
  const lo = single && single.indexOf(Math.min(...single));

  return (
    <figure className="chart">
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.key}>
              <i className={`swatch series-${s.key}`} />
              {s.label} <span className="muted">({s.data.annual.toFixed(2)}/hari)</span>
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PSH bulanan">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 4} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {MONTHS.map((month, i) => {
          const active = period === 0 || period === i + 1;
          return (
            <g key={month} className={active ? undefined : "muted"}>
              {series.map((s, k) => {
                const v = s.data.monthly[i];
                const x = PAD.left + i * slot + GROUP_GAP / 2 + k * (barW + BAR_GAP);
                const top = y(v);
                const h = PAD.top + plotH - top;
                const r = Math.min(4, h, barW / 2);
                // Rounded top, square base anchored to the baseline.
                const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
                return (
                  <g key={s.key}>
                    <path d={d} className={`bar series-${s.key}`} />
                    {(i === hi || i === lo) && (
                      <text x={x + barW / 2} y={top - 4} className="label" textAnchor="middle">
                        {v.toFixed(1)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={PAD.left + (i + 0.5) * slot} y={H - 6} className="axis" textAnchor="middle">
                {month[0]}
              </text>
              <rect
                x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="tooltip"
          style={{ left: `${((PAD.left + (hover + 0.5) * slot) / W) * 100}%` }}
        >
          <strong>{MONTHS[hover]}</strong>
          {series.map((s) => (
            <div key={s.key}>
              {s.label}: <strong>{s.data.monthly[hover].toFixed(2)}</strong> jam/hari
            </div>
          ))}
        </div>
      )}
      {note && <figcaption>{note}</figcaption>}
      <details>
        <summary>Lihat tabel</summary>
        <table>
          <thead>
            <tr>
              <th>Bulan</th>
              {series.map((s) => <th key={s.key}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((month, i) => (
              <tr key={month}>
                <td>{month}</td>
                {series.map((s) => <td key={s.key}>{s.data.monthly[i].toFixed(2)}</td>)}
              </tr>
            ))}
            <tr>
              <td>Tahunan</td>
              {series.map((s) => <td key={s.key}>{s.data.annual.toFixed(2)}</td>)}
            </tr>
          </tbody>
        </table>
      </details>
    </figure>
  );
}

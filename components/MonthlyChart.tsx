"use client";

import { useState } from "react";
import { MONTHS, type Climatology, type Period } from "@/lib/psh";

const W = 320;
const H = 160;
const PAD = { top: 18, right: 4, bottom: 20, left: 26 };
const GAP = 2;

/** Single-series bar chart of monthly PSH, with per-bar hover and a table view. */
export default function MonthlyChart({ data, period }: { data: Climatology; period: Period }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(7, Math.ceil(Math.max(...data.monthly)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / 12;
  const barW = slot - GAP;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.floor(max / 2) + 1 }, (_, i) => i * 2);
  const hi = data.monthly.indexOf(Math.max(...data.monthly));
  const lo = data.monthly.indexOf(Math.min(...data.monthly));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PSH bulanan">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 4} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left} x2={W - PAD.right} y1={y(data.annual)} y2={y(data.annual)}
          className="ref"
        />
        {data.monthly.map((v, i) => {
          const x = PAD.left + i * slot + GAP / 2;
          const top = y(v);
          const h = PAD.top + plotH - top;
          const r = Math.min(4, h, barW / 2);
          const active = period === 0 || period === i + 1;
          // Rounded top, square base anchored to the baseline.
          const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
          return (
            <g key={i}>
              <path d={d} className={active ? "bar" : "bar muted"} />
              {(i === hi || i === lo) && (
                <text x={x + barW / 2} y={top - 4} className="label" textAnchor="middle">
                  {v.toFixed(1)}
                </text>
              )}
              <text x={x + barW / 2} y={H - 6} className="axis" textAnchor="middle">
                {MONTHS[i][0]}
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
          {MONTHS[hover]}: <strong>{data.monthly[hover].toFixed(2)}</strong> jam/hari
        </div>
      )}
      <figcaption>
        Garis putus-putus = rata-rata tahunan ({data.annual.toFixed(2)} jam/hari)
      </figcaption>
      <details>
        <summary>Lihat tabel</summary>
        <table>
          <thead>
            <tr><th>Bulan</th><th>PSH (jam/hari)</th></tr>
          </thead>
          <tbody>
            {data.monthly.map((v, i) => (
              <tr key={i}><td>{MONTHS[i]}</td><td>{v.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

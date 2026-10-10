"use client";

import { useState } from "react";
import { cx } from "./ui";

export interface DayPoint {
  day: string;
  create: number;
  update: number;
  delete: number;
}

const SERIES = [
  { key: "create", label: "Created", color: "var(--color-series-1)" },
  { key: "update", label: "Updated", color: "var(--color-series-2)" },
  { key: "delete", label: "Deleted", color: "var(--color-series-3)" },
] as const;

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };
const GAP = 2; // surface gap between stacked segments
const R = 4; // rounded data-end

function niceMax(n: number) {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s * 4 >= n) ?? pow * 10;
  return step * 4;
}

function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Stacked daily operations (create / update / delete) over the last 14 days. */
export function ActivityChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const totals = data.map((d) => d.create + d.update + d.delete);
  const max = niceMax(Math.max(0, ...totals));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const col = plotW / data.length;
  const barW = Math.min(28, col * 0.62);
  const y = (v: number) => (v / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const grandTotal = totals.reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-4 text-xs text-slate-600" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button onClick={() => setAsTable((t) => !t)} className="text-xs font-medium text-brand-700 hover:underline">
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-4">Day</th>
                {SERIES.map((s) => <th key={s.key} className="py-1.5 pr-4 text-right">{s.label}</th>)}
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {data.map((d, i) => (
                <tr key={d.day}>
                  <td className="py-1.5 pr-4 text-slate-700">{dayLabel(d.day)}</td>
                  {SERIES.map((s) => <td key={s.key} className="py-1.5 pr-4 text-right text-slate-700">{d[s.key]}</td>)}
                  <td className="py-1.5 text-right font-medium text-slate-900">{totals[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Operations per day over ${data.length} days, ${grandTotal} in total`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH - y(t)} y2={PAD.top + plotH - y(t)} stroke="#e2e8f0" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={PAD.left - 8} y={PAD.top + plotH - y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx0 = PAD.left + col * i + col / 2;
              const x = cx0 - barW / 2;
              let base = PAD.top + plotH;
              const segs = SERIES.map((s) => ({ ...s, v: d[s.key] })).filter((s) => s.v > 0);
              const showLabel = i % 2 === (data.length - 1) % 2;
              return (
                <g key={d.day}>
                  {segs.map((s, si) => {
                    const h = Math.max(1, y(s.v) - (si > 0 ? GAP : 0));
                    const top = base - h;
                    const isTop = si === segs.length - 1;
                    const shape = isTop ? (
                      <path
                        key={s.key}
                        d={`M${x},${base} V${top + Math.min(R, h)} Q${x},${top} ${x + Math.min(R, h)},${top} H${x + barW - Math.min(R, h)} Q${x + barW},${top} ${x + barW},${top + Math.min(R, h)} V${base} Z`}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.45}
                      />
                    ) : (
                      <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />
                    );
                    base = top - GAP;
                    return shape;
                  })}
                  {showLabel && (
                    <text x={cx0} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
                      {dayLabel(d.day)}
                    </text>
                  )}
                  {/* Hit target spans the whole column, larger than the mark */}
                  <rect x={PAD.left + col * i} y={PAD.top} width={col} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className={cx("pointer-events-none absolute top-0 z-10 w-40 rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200")}
              style={{ left: `clamp(0px, calc(${((PAD.left + col * hover + col / 2) / W) * 100}% - 5rem), calc(100% - 10rem))` }}
            >
              <p className="mb-1 font-medium text-slate-900">{dayLabel(data[hover].day)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="tabular-nums text-slate-900">{data[hover][s.key]}</span>
                </p>
              ))}
              <p className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{totals[hover]}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

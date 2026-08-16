'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CHROME, fmtCompact, fmtDay, fmtFull, niceTicks, useChartWidth } from './viz';
import { Legend } from './ChartCard';

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };
/** The surface gap that separates touching segments. White does the separating. */
const GAP = 2;
const MAX_BAR = 24;

/** A column segment: square at the baseline, optionally rounded at the data end. */
function segmentPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - rr}h${-w}Z`;
}

/**
 * Daily stacked columns.
 *
 * Segments are separated by a 2px gap in the SURFACE color, never by a stroke —
 * a border around a mark adds ink that isn't data. The same gap width runs
 * between every segment and between adjacent columns, so the whole plot reads as
 * one rhythm.
 *
 * The hit target is the whole column, not the individual segment: a one-pixel
 * segment on a quiet day is not something anyone can point at, and its value is
 * still in the readout and the table view.
 */
export function StackedBars({
  points,
  series,
  height = 240,
}: {
  points: Array<Record<string, unknown>>;
  series: StackSeries[];
  height?: number;
}) {
  const t = useTranslations('admin.dashboard.analytics');
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = Math.max(1, height - PAD.top - PAD.bottom);

  const { ticks, max, band, barW } = useMemo(() => {
    let m = 0;
    for (const p of points) {
      m = Math.max(
        m,
        series.reduce((sum, s) => sum + Number(p[s.key] ?? 0), 0),
      );
    }
    const t = niceTicks(m);
    const b = points.length > 0 ? innerW / points.length : innerW;
    return {
      ticks: t,
      max: t[t.length - 1] ?? 1,
      band: b,
      barW: Math.min(MAX_BAR, Math.max(2, b - GAP)),
    };
  }, [points, series, innerW]);

  const base = PAD.top + innerH;
  const scale = (v: number) => (v / max) * innerH;
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.left) / band);
    setHover(i >= 0 && i < points.length ? i : null);
  };

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t('chart.columnsAria', { series: series.map((s) => s.label).join(', ') })}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="touch-none"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={base - scale(t)}
              y2={base - scale(t)}
              stroke={CHROME.grid}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={base - scale(t) + 4}
              textAnchor="end"
              className="fill-neutral-500 text-[10px] tabular-nums"
            >
              {fmtCompact(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const x = PAD.left + i * band + (band - barW) / 2;
          let cursor = base;
          const present = series.filter((s) => Number(p[s.key] ?? 0) > 0);
          const topKey = present[present.length - 1]?.key;
          return (
            <g key={String(p.date)} opacity={hover === null || hover === i ? 1 : 0.55}>
              {present.map((s) => {
                const h = Math.max(1, scale(Number(p[s.key] ?? 0)) - GAP);
                cursor -= h + GAP;
                // The 4px round belongs to the DATA END — the top of the stack —
                // and nowhere else; interior segments stay square against the gap.
                return (
                  <path
                    key={s.key}
                    d={segmentPath(x, cursor, barW, h, s.key === topKey ? 4 : 0)}
                    fill={s.color}
                  />
                );
              })}
              {present.length === 0 && (
                <rect x={x} y={base - 1} width={barW} height={1} fill={CHROME.grid} />
              )}
            </g>
          );
        })}

        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text
              key={`t-${String(p.date)}`}
              x={PAD.left + i * band + band / 2}
              y={height - 6}
              textAnchor="middle"
              className="fill-neutral-500 text-[10px]"
            >
              {fmtDay(String(p.date))}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-2 min-h-[1.5rem] text-xs" aria-live="polite">
        {hover !== null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-neutral-900">
              {fmtDay(String(points[hover]?.date ?? ''))}
            </span>
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-semibold tabular-nums text-neutral-900">
                  {fmtFull(Number(points[hover]?.[s.key] ?? 0))}
                </span>
                <span className="text-neutral-600">{s.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-neutral-600">{t('chart.hoverColumn')}</span>
        )}
      </div>

      <Legend
        items={series.map((s) => ({
          label: s.label,
          color: s.color,
          value: points.reduce((sum, p) => sum + Number(p[s.key] ?? 0), 0),
        }))}
      />
    </div>
  );
}

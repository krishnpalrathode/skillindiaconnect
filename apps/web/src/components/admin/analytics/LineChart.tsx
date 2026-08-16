'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CHROME, fmtCompact, fmtDay, fmtFull, niceTicks, useChartWidth } from './viz';
import { Legend } from './ChartCard';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Wash the area under the line (~10% opacity). Reserve it for the lead series. */
  area?: boolean;
}

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/**
 * Multi-series line chart with a crosshair readout.
 *
 * ONE Y-AXIS, always. Two measures of different scale get two charts — a second
 * axis lets the author slide one curve over the other until they "correlate",
 * which is the single most common way a chart lies.
 *
 * The crosshair snaps to the nearest day and reports EVERY series at that day, so
 * the reader aims at a date rather than trying to land on a 2px stroke.
 */
export function LineChart({
  points,
  series,
  height = 240,
  showLegend = true,
}: {
  points: Array<Record<string, unknown>>;
  series: LineSeries[];
  height?: number;
  showLegend?: boolean;
}) {
  const t = useTranslations('admin.dashboard.analytics');
  const [ref, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = Math.max(1, height - PAD.top - PAD.bottom);

  const { max, ticks, xs } = useMemo(() => {
    let m = 0;
    for (const p of points) for (const s of series) m = Math.max(m, Number(p[s.key] ?? 0));
    const t = niceTicks(m);
    const top = t[t.length - 1] ?? 1;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    return { max: top, ticks: t, xs: points.map((_, i) => PAD.left + i * step) };
  }, [points, series, innerW]);

  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const path = (key: string) =>
    points
      .map(
        (p, i) => `${i === 0 ? 'M' : 'L'}${xs[i]?.toFixed(1)},${y(Number(p[key] ?? 0)).toFixed(1)}`,
      )
      .join(' ');

  const areaPath = (key: string) => {
    if (points.length === 0) return '';
    const first = xs[0] ?? PAD.left;
    const last = xs[xs.length - 1] ?? PAD.left;
    const base = PAD.top + innerH;
    return `${path(key)} L${last.toFixed(1)},${base} L${first.toFixed(1)},${base} Z`;
  };

  // Label roughly six x ticks however long the window is — a 365-day window must
  // not print 365 overlapping dates.
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (points.length === 0) return;
    const step = points.length > 1 ? innerW / (points.length - 1) : 1;
    const i = Math.round((x - PAD.left) / step);
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hoveredDate = hover !== null ? String(points[hover]?.date ?? '') : '';

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t('chart.lineAria', { series: series.map((s) => s.label).join(', ') })}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="touch-none"
      >
        {/* Gridlines — hairline, solid, recessive. Never dashed. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke={CHROME.grid}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-neutral-500 text-[10px] tabular-nums"
            >
              {fmtCompact(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text
              key={String(p.date)}
              x={xs[i]}
              y={height - 6}
              textAnchor="middle"
              className="fill-neutral-500 text-[10px]"
            >
              {fmtDay(String(p.date))}
            </text>
          ) : null,
        )}

        {series
          .filter((s) => s.area)
          .map((s) => (
            <path key={`a-${s.key}`} d={areaPath(s.key)} fill={s.color} fillOpacity={0.1} />
          ))}

        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover !== null && (
          <g pointerEvents="none">
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke={CHROME.axis}
              strokeWidth={1}
            />
            {series.map((s) => (
              // 2px surface ring so the dot stays legible where series cross.
              <circle
                key={`h-${s.key}`}
                cx={xs[hover]}
                cy={y(Number(points[hover]?.[s.key] ?? 0))}
                r={4}
                fill={s.color}
                stroke={CHROME.surface}
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* The readout: value leads, series name follows — the reader already knows
          which series they want; they came for the number. */}
      <div className="mt-2 min-h-[1.5rem] text-xs" aria-live="polite">
        {hover !== null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-neutral-900">{fmtDay(hoveredDate)}</span>
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3.5 rounded-full"
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
          <span className="text-neutral-600">{t('chart.hoverLine')}</span>
        )}
      </div>

      {showLegend && (
        <Legend
          variant="line"
          items={series.map((s) => ({
            label: s.label,
            color: s.color,
            value: points.reduce((sum, p) => sum + Number(p[s.key] ?? 0), 0),
          }))}
        />
      )}
    </div>
  );
}

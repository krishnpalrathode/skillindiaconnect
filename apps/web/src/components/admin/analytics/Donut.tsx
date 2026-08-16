'use client';

import React, { useState } from 'react';
import { CHROME, SERIES, fmtCompact, fmtFull, fmtPct } from './viz';
import { Legend } from './ChartCard';

export interface DonutSlice {
  label: string;
  value: number;
}

const SIZE = 168;
const STROKE = 22;
/** The 2px surface gap, expressed as an arc — the same spacer the bars use. */
const GAP_DEG = 1.6;

/**
 * A donut for a PART-OF-WHOLE breakdown — never for change over time, and never
 * for a set that doesn't actually sum to a meaningful whole.
 *
 * The centre carries the total, which is the number a donut is otherwise bad at
 * communicating. Every slice's value and share appear in the legend, so nobody
 * has to estimate an angle.
 */
export function Donut({
  slices,
  centerLabel,
  colors = SERIES as unknown as string[],
}: {
  slices: DonutSlice[];
  centerLabel: string;
  colors?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (SIZE - STROKE) / 2;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  let angle = -90;
  const arcs = slices.map((s, i) => {
    const sweep = total > 0 ? (s.value / total) * 360 : 0;
    const start = angle + (sweep > GAP_DEG ? GAP_DEG / 2 : 0);
    const end = angle + sweep - (sweep > GAP_DEG ? GAP_DEG / 2 : 0);
    angle += sweep;
    return { ...s, start, end, color: colors[i % colors.length] ?? SERIES[0], index: i };
  });

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={SIZE} height={SIZE} role="img" aria-label={`${centerLabel}: ${total}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={CHROME.grid} strokeWidth={STROKE} />
          {arcs.map((a) =>
            a.end > a.start ? (
              <path
                key={a.label}
                d={arcPath(cx, cy, r, a.start, a.end)}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                opacity={hover === null || hover === a.index ? 1 : 0.45}
                onPointerEnter={() => setHover(a.index)}
                onPointerLeave={() => setHover(null)}
                className="cursor-default"
              />
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold text-neutral-900">
            {hover !== null ? fmtCompact(slices[hover]?.value ?? 0) : fmtCompact(total)}
          </span>
          <span className="max-w-[6.5rem] truncate text-[11px] text-neutral-600">
            {hover !== null ? slices[hover]?.label : centerLabel}
          </span>
        </div>
      </div>

      <Legend
        items={arcs.map((a) => ({
          label: a.label,
          color: a.color,
          value: `${fmtFull(a.value)} · ${total > 0 ? fmtPct((a.value / total) * 100) : '0%'}`,
        }))}
      />
    </div>
  );
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const p = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = p(startDeg);
  const [x2, y2] = p(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  // A full circle can't be drawn as one arc — split it, or it renders as nothing.
  if (endDeg - startDeg >= 359.9) {
    const [xm, ym] = p(startDeg + 180);
    return `M${x1},${y1}A${r},${r} 0 1 1 ${xm},${ym}A${r},${r} 0 1 1 ${x1},${y1}`;
  }
  return `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}`;
}

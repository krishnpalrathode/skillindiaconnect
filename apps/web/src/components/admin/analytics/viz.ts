'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The chart palette — VALIDATED, not chosen by eye.
 *
 * These five hexes in THIS ORDER were run through the dataviz validator against
 * the card surface the admin console actually renders on (#ffffff, light mode):
 *
 *   Lightness band  PASS · Chroma floor PASS
 *   CVD separation  PASS — worst adjacent pair ΔE 9.1 (protan)
 *   Normal vision   PASS — worst adjacent pair ΔE 19.6
 *   Contrast        WARN — aqua/yellow/magenta sit below 3:1 on white
 *
 * The contrast WARN is not dismissable: it obliges RELIEF, which is why every
 * chart in this folder ships a legend carrying the numeric value and every card
 * has a table view. Do not reorder these — the ORDER is the colorblind-safety
 * mechanism (adjacency is what the CVD check measures), and slot 4 beside slot 2
 * puts yellow next to orange, which fails the all-pairs floor. A sixth series
 * folds into "Other" rather than getting a generated hue.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;

/**
 * Reserved STATUS colors — never reused as "series 6". They always ship with an
 * icon and a label, because two of them sit below 3:1 on white by design and
 * hue alone is not allowed to carry the meaning.
 */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** An ORDINAL blue ramp for the funnel — one hue, monotone lightness (validated). */
export const FUNNEL_RAMP = ['#86b6ef', '#2a78d6', '#184f95'] as const;

/** Chart chrome. Hairline, solid, one step off the surface — recessive by design. */
export const CHROME = {
  surface: '#ffffff',
  grid: '#e8ecf2',
  axis: '#cbd5e1',
} as const;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** 1,284 → "1,284"; 20,009 → "20K". Axis ticks and tile values. */
export function fmtCompact(n: number): string {
  return Math.abs(n) >= 10000 ? compact.format(n) : full.format(n);
}

export function fmtFull(n: number): string {
  return full.format(n);
}

export function fmtPct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

/** "2026-08-16" → "16 Aug". Axis ticks and tooltips; never a raw ISO string. */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The chart's pixel width, measured.
 *
 * SVG charts need a real width: a viewBox scaled with `preserveAspectRatio` would
 * stretch the 2px strokes and the 4px corner radii along with the geometry, which
 * is precisely the spec these charts are built to.
 */
export function useChartWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    // jsdom has no ResizeObserver. Falling back to the default width keeps the
    // chart renderable under test (and in any non-measuring environment) instead
    // of throwing out of an effect and taking the whole dashboard down with it.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Clean y-axis ticks (0 / 500 / 1,000) — never `1,283.33`.
 *
 * Steps are WHOLE NUMBERS because every series on this dashboard is a count of
 * rows. A quiet week peaking at one registration was drawing an axis of 0, 0.25,
 * 0.5, 0.75, 1 — a quarter of a candidate is not a thing, and fractional ticks
 * on integer data read as a bug in the number rather than a choice about the
 * axis. The 2.5 multiplier is dropped for the same reason.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  if (max <= count) {
    // Fewer distinct values than tick slots: one tick per integer, no scaling.
    return Array.from({ length: Math.ceil(max) + 1 }, (_, i) => i);
  }
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

/** Series values off a zero-filled point, as numbers. */
export function valuesOf(points: Array<Record<string, unknown>>, key: string): number[] {
  return points.map((p) => Number(p[key] ?? 0));
}

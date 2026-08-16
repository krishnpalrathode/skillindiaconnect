'use client';

import React from 'react';
import { fmtFull } from './viz';

export interface BarItem {
  label: string;
  value: number;
  /** Optional per-item color. Defaults to one hue — a ranked list is ONE series. */
  color?: string;
}

/**
 * Horizontal bars for a ranked list (top skills, distributions).
 *
 * ONE hue by default, not a rainbow: the bars are one series measured on one
 * scale, and coloring each row differently would imply a category that isn't
 * there. Length carries the magnitude; the value is direct-labelled at the tip,
 * so this chart never depends on judging fill color.
 *
 * Built with divs rather than SVG — a bar list is a list, and this way the labels
 * wrap, truncate and translate like ordinary text.
 */
export function BarList({
  items,
  color = '#2a78d6',
  valueSuffix,
  emptyMessage,
}: {
  items: BarItem[];
  color?: string;
  valueSuffix?: string;
  /** Supplied by the caller, which owns the copy — this primitive holds no strings. */
  emptyMessage?: string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);

  if (items.length === 0) {
    return <p className="py-6 text-sm text-neutral-600">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-neutral-600" title={item.label}>
            {item.label}
          </span>
          <span className="relative h-4 flex-1 overflow-visible rounded-sm bg-neutral-100">
            <span
              className="absolute inset-y-0 start-0 rounded-e"
              style={{
                width: `${max > 0 ? Math.max(2, (item.value / max) * 100) : 0}%`,
                backgroundColor: item.color ?? color,
              }}
            />
          </span>
          <span className="w-16 shrink-0 text-end text-xs font-semibold tabular-nums text-neutral-900">
            {fmtFull(item.value)}
            {valueSuffix}
          </span>
        </li>
      ))}
    </ul>
  );
}

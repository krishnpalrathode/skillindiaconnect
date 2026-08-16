'use client';

import React, { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Table as TableIcon, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableView {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * The frame every chart sits in — and the home of the TABLE VIEW toggle.
 *
 * The table is not a nicety. The validated palette carries a contrast WARN (three
 * of its five hues sit below 3:1 on white), and the dataviz rule is that a
 * contrast WARN obliges relief: visible labels or a table view. Every chart here
 * ships both, so no value is ever reachable only by hovering a pale mark.
 */
export function ChartCard({
  title,
  subtitle,
  note,
  table,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  /** A caveat about what the numbers DO and DON'T mean. Rendered, not hidden in a tooltip. */
  note?: string;
  table?: TableView;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('admin.dashboard.analytics');
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();

  return (
    <section
      className={cn(
        'flex flex-col rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm',
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-neutral-600">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              aria-controls={bodyId}
              className="flex size-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {showTable ? (
                <BarChart3 className="size-4" aria-hidden="true" />
              ) : (
                <TableIcon className="size-4" aria-hidden="true" />
              )}
              <span className="sr-only">
                {showTable ? t('chart.showChart') : t('chart.showTable')}
              </span>
            </button>
          )}
        </div>
      </header>

      <div id={bodyId} className="min-w-0 flex-1">
        {showTable && table ? <DataTable table={table} /> : children}
      </div>

      {note && <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">{note}</p>}
    </section>
  );
}

function DataTable({ table }: { table: TableView }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-neutral-200">
            {table.columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  'py-2 text-xs font-medium text-neutral-600',
                  i === 0 ? 'text-start' : 'text-end',
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-neutral-100 last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    'py-1.5 text-neutral-700',
                    ci === 0 ? 'text-start' : 'text-end tabular-nums',
                  )}
                >
                  {typeof cell === 'number' ? cell.toLocaleString('en') : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The legend — ALWAYS present for two or more series, never for one (the title
 * already names a single series). It carries the series TOTAL beside each name,
 * which is what discharges the palette's contrast WARN: identity and magnitude
 * both survive without reading a pale fill.
 */
export function Legend({
  items,
  variant = 'rect',
}: {
  items: Array<{ label: string; color: string; value?: number | string }>;
  /** `line` mirrors a line chart's mark, `rect` a bar's or an area's. */
  variant?: 'line' | 'rect';
}) {
  if (items.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={cn('shrink-0 rounded-full', variant === 'line' ? 'h-0.5 w-3.5' : 'size-2.5')}
            style={{ backgroundColor: it.color }}
          />
          <span className="text-neutral-600">{it.label}</span>
          {it.value !== undefined && (
            <span className="font-semibold tabular-nums text-neutral-900">
              {typeof it.value === 'number' ? it.value.toLocaleString('en') : it.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

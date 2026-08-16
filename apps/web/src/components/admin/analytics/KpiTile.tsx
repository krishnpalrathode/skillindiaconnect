'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtCompact, fmtFull, fmtPct } from './viz';
import type { AnalyticsKpi } from '@/lib/api/admin-analytics';

/**
 * A 12-point sparkline — trend only, no axes and no hover.
 *
 * It is DE-EMPHASISED on purpose: the tile's job is the number, and a sparkline
 * that competes with it turns five tiles into five charts. It carries shape, not
 * values; the values live in the chart below and in that chart's table view.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 96;
  const h = 28;
  if (values.length < 2) return <svg width={w} height={h} aria-hidden="true" />;

  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (v / max) * (h - 3) - 1.5] as const);
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={w} height={h} aria-hidden="true" className="overflow-visible">
      <path d={area} fill={color} fillOpacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last && (
        <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="#ffffff" strokeWidth={2} />
      )}
    </svg>
  );
}

/**
 * One executive KPI.
 *
 * The delta is signed and NAMES its comparison period — "vs previous 30 days" —
 * because a percentage with no stated baseline is not a fact. Growth from a
 * previous window of zero has no rate at all, so it renders "New" rather than a
 * fabricated ∞ or 100% — EXCEPT when this window is also zero, which is not
 * newness, it is nothing happening, and says so.
 *
 * Direction is never carried by color alone: the arrow icon and the text say it.
 */
export function KpiTile({
  label,
  kpi,
  color,
  periodLabel,
  href,
  formatValue,
}: {
  label: string;
  kpi: AnalyticsKpi;
  color: string;
  periodLabel: string;
  href?: string;
  /** Override for non-count values (money, which is INTEGER SUBUNITS on the wire). */
  formatValue?: (n: number) => string;
}) {
  const t = useTranslations('admin.dashboard.analytics.kpi');

  // 0 → 0 is "no activity", not "New". Only a genuine start from nothing is new.
  const empty = kpi.deltaPct === null && kpi.value === 0;
  const isNew = kpi.deltaPct === null && kpi.value > 0;
  const up = (kpi.deltaPct ?? 0) > 0;
  const flat = kpi.deltaPct === 0;
  const neutral = kpi.deltaPct === null || flat;
  const Icon = neutral ? Minus : up ? TrendingUp : TrendingDown;

  const body = (
    <>
      {/* The label gets its OWN line. Sharing a row with the sparkline truncated
          it to "New candi…" at five-across, which is the one thing on the tile
          that must always be readable. */}
      <p className="text-xs font-medium text-neutral-600">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold leading-none text-neutral-900">
          {formatValue ? formatValue(kpi.value) : fmtCompact(kpi.value)}
        </p>
        <Sparkline values={kpi.spark} color={color} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            neutral ? 'text-neutral-600' : up ? 'text-[#0ca30c]' : 'text-[#d03b3b]',
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            'font-semibold tabular-nums',
            neutral ? 'text-neutral-600' : up ? 'text-[#006300]' : 'text-[#b02b2b]',
          )}
        >
          {empty ? t('none') : isNew ? t('new') : `${up ? '+' : ''}${fmtPct(kpi.deltaPct ?? 0)}`}
        </span>
        {/* Wraps rather than truncating: a delta whose comparison period is cut
            off to "vs previous…" is a percentage with no stated baseline, which
            is not a fact. */}
        <span className="text-neutral-600">
          {empty
            ? t('emptyBoth', { period: periodLabel })
            : isNew
              ? t('noneInPeriod', { period: periodLabel })
              : t('vsPrevious', {
                  period: periodLabel,
                  value: formatValue ? formatValue(kpi.previous) : fmtFull(kpi.previous),
                })}
        </span>
      </div>
    </>
  );

  const cls =
    'flex flex-col rounded-2xl border border-neutral-200/70 bg-white p-4 shadow-sm transition hover:shadow-md';

  return href ? (
    <a
      href={href}
      className={cn(
        cls,
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
      )}
    >
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

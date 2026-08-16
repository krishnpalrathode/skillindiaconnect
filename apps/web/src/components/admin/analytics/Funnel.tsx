'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import { FUNNEL_RAMP, fmtFull, fmtPct } from './viz';
import type { AnalyticsFunnelStage } from '@/lib/api/admin-analytics';

/**
 * The hiring funnel — an ORDINAL ramp (one hue, darkening down the stages), not
 * four unrelated categorical hues: the stages are ordered, and ordered data gets
 * an ordered ramp.
 *
 * The conversion between stages is printed BETWEEN the bars, because that ratio
 * is the thing anyone actually reads a funnel for. Each bar is direct-labelled,
 * so no value depends on estimating a width.
 */
export function Funnel({ stages }: { stages: AnalyticsFunnelStage[] }) {
  const t = useTranslations('admin.dashboard.analytics.funnel');

  if (stages.length === 0 || (stages[0]?.count ?? 0) === 0) {
    return <p className="py-6 text-sm text-neutral-600">{t('empty')}</p>;
  }

  return (
    <ol className="flex flex-col">
      {stages.map((s, i) => (
        <li key={s.stage}>
          {i > 0 && (
            <div className="flex items-center gap-1.5 py-1.5 ps-1 text-xs text-neutral-600">
              <ArrowDown className="size-3.5" aria-hidden="true" />
              <span>
                <span className="font-semibold text-neutral-800">
                  {s.conversionFromPrev === null ? '—' : fmtPct(s.conversionFromPrev)}
                </span>{' '}
                {t('continueLabel')}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 min-w-[4rem] items-center rounded-e-lg px-3"
              style={{
                width: `${Math.max(12, s.pctOfTop)}%`,
                backgroundColor: FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)],
              }}
            >
              {/* White ink on the two darker steps, ink on the lightest — chosen by
                  the fill's luminance so the label always clears contrast. */}
              <span
                className={`truncate text-sm font-semibold ${i === 0 ? 'text-neutral-900' : 'text-white'}`}
              >
                {fmtFull(s.count)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800">{t(s.stage)}</p>
              <p className="text-xs text-neutral-600">
                {t('shareOfApplications', { pct: fmtPct(s.pctOfTop) })}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

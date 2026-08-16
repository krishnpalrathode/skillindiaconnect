'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ANALYTICS_RANGES } from '@/lib/api/admin-analytics';

const LABEL_KEY: Record<number, string> = {
  7: 'range.d7',
  30: 'range.d30',
  90: 'range.d90',
  365: 'range.d365',
};

/**
 * The date range — ONE row, above everything it scopes.
 *
 * It is presets, not a calendar: nobody fights a month grid to say "last 30
 * days". Selection is marked by a check as well as by the filled pill, so the
 * active range never rests on color alone.
 */
export function RangeFilter({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin.dashboard.analytics');
  return (
    <div
      role="group"
      aria-label={t('rangeLabel')}
      className="flex flex-wrap items-center gap-1 rounded-xl border border-neutral-200/70 bg-white p-1 shadow-sm"
    >
      {ANALYTICS_RANGES.map((days) => {
        const active = days === value;
        return (
          <button
            key={days}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(days)}
            className={cn(
              'flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:opacity-60',
              active
                ? 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-100',
            )}
          >
            {active && <Check className="size-3.5" aria-hidden="true" />}
            {t(LABEL_KEY[days] ?? 'range.other', { days })}
          </button>
        );
      })}
    </div>
  );
}

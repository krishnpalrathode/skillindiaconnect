'use client';

import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';

type ApplicationStatus = components['schemas']['ApplicationStatus'];
export type StatusFilter = 'ALL' | ApplicationStatus;

const TABS: StatusFilter[] = ['ALL', 'PENDING', 'SHORTLISTED', 'SELECTED', 'REJECTED'];

interface StatusFilterTabsProps {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}

export function StatusFilterTabs({ value, onChange }: StatusFilterTabsProps) {
  const t = useTranslations('applications');

  return (
    <div role="tablist" aria-label={t('filterLabel')} className="flex gap-1.5 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const selected = value === tab;
        return (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls="applications-list"
            onClick={() => onChange(tab)}
            className={cn(
              'min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              selected
                ? 'bg-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
            )}
          >
            {tab === 'ALL' ? t('filter.all') : t(`status.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';
import type { ApplicantSort } from '@/lib/api/applicants';

type ApplicationStatus = components['schemas']['ApplicationStatus'];
type ApplicantCounts = components['schemas']['ApplicantCounts'];
export type ApplicantStatusFilter = 'ALL' | ApplicationStatus;

const TABS: ApplicantStatusFilter[] = ['ALL', 'PENDING', 'SHORTLISTED', 'SELECTED', 'REJECTED'];

interface ApplicantFiltersProps {
  counts: ApplicantCounts;
  status: ApplicantStatusFilter;
  sort: ApplicantSort;
  onStatusChange: (s: ApplicantStatusFilter) => void;
  onSortChange: (s: ApplicantSort) => void;
}

export function ApplicantFilters({
  counts,
  status,
  sort,
  onStatusChange,
  onSortChange,
}: ApplicantFiltersProps) {
  const t = useTranslations('applicants');

  const countFor = (tab: ApplicantStatusFilter): number => {
    switch (tab) {
      case 'PENDING':
        return counts.pending;
      case 'SHORTLISTED':
        return counts.shortlisted;
      case 'SELECTED':
        return counts.selected;
      case 'REJECTED':
        return counts.rejected;
      default:
        return counts.pending + counts.shortlisted + counts.selected + counts.rejected;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t('filterLabel')}
        className="flex gap-1.5 overflow-x-auto pb-1"
      >
        {TABS.map((tab) => {
          const n = countFor(tab);
          const label = tab === 'ALL' ? t('filter.all') : t(`status.${tab}`);
          const selected = status === tab;
          return (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls="applicants-list"
              aria-label={t('tabSrLabel', { label, count: n })}
              onClick={() => onStatusChange(tab)}
              className={cn(
                'min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-all',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                selected
                  ? 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white shadow-md shadow-[#0F3D91]/20'
                  : 'bg-white text-neutral-700 ring-1 ring-neutral-200/70 hover:text-[#0F3D91] hover:shadow-sm',
              )}
            >
              {label} <span className="tabular-nums opacity-80">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">{t('sortLabel')}</span>
        <div className="inline-flex gap-1 overflow-hidden rounded-xl bg-white p-1 ring-1 ring-neutral-200/70">
          {(['match', 'recent'] as ApplicantSort[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => onSortChange(s)}
              className={cn(
                'min-h-10 rounded-lg px-3.5 text-sm font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                sort === s
                  ? 'bg-[#0F3D91] text-white shadow-sm'
                  : 'text-neutral-700 hover:bg-neutral-100 hover:text-[#0F3D91]',
              )}
            >
              {t(`sort.${s}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

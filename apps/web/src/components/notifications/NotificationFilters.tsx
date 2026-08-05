'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { NotificationListParams } from '@/lib/api/notifications';

type FilterValue = NonNullable<NotificationListParams['filter']>;

interface NotificationFiltersProps {
  activeFilter: FilterValue | undefined;
  unreadOnly: boolean;
  onFilterChange: (filter: FilterValue | undefined) => void;
  onUnreadToggle: (unread: boolean) => void;
}

const FILTER_TABS: Array<{ key: FilterValue | 'all'; labelKey: string }> = [
  { key: 'all', labelKey: 'all' },
  { key: 'applications', labelKey: 'applications' },
  { key: 'jobs', labelKey: 'jobs' },
  { key: 'profile', labelKey: 'profile' },
  { key: 'system', labelKey: 'system' },
];

export function NotificationFilters({
  activeFilter,
  unreadOnly,
  onFilterChange,
  onUnreadToggle,
}: NotificationFiltersProps) {
  const t = useTranslations('notifications.filters');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="tablist"
        aria-label={t('all')}
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1 scrollbar-hide"
      >
        {FILTER_TABS.map(({ key, labelKey }) => {
          const isActive = key === 'all' ? !activeFilter : activeFilter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onFilterChange(key === 'all' ? undefined : (key as FilterValue))}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                isActive
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
              )}
            >
              {t(labelKey as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      {/*
        Presented as a chip so it reads as a sibling of the category filters
        rather than a stray form control on its own row — but it stays a real
        <input type="checkbox">, so it keeps checkbox semantics and its
        checked state is announced.
      */}
      <label
        className={cn(
          'group inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
          'focus-within:ring-[3px] focus-within:ring-ring/70',
          unreadOnly
            ? 'border-primary-600 bg-primary-50 text-primary-700'
            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
        )}
      >
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => onUnreadToggle(e.target.checked)}
          className="size-4 rounded border-neutral-300 text-primary-600 focus:outline-none focus:ring-0 focus:ring-offset-0"
        />
        {t('unreadOnly')}
      </label>
    </div>
  );
}

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
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t('all')}
        className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide"
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
                'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
              )}
            >
              {t(labelKey as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => onUnreadToggle(e.target.checked)}
          className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500 size-4"
        />
        <span className="text-sm text-neutral-700">{t('unreadOnly')}</span>
      </label>
    </div>
  );
}

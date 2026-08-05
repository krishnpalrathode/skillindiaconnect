'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCheck } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';
import {
  listNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  type NotificationListParams,
} from '@/lib/api/notifications';
import { NotificationFilters } from './NotificationFilters';
import { NotificationItem } from './NotificationItem';
import { NotificationEmptyState } from './NotificationEmptyState';
import { NotificationSkeleton } from './NotificationSkeleton';

type Notification = components['schemas']['Notification'];
type FilterValue = NonNullable<NotificationListParams['filter']>;

function getDateGroup(isoDate: string, now: Date): string {
  const date = new Date(isoDate);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 7) return 'thisWeek';
  return 'older';
}

function groupByDate(
  notifications: Notification[],
  now: Date,
): Array<{ group: string; items: Notification[] }> {
  const map = new Map<string, Notification[]>();
  const ORDER = ['today', 'yesterday', 'thisWeek', 'older'];

  for (const n of notifications) {
    const g = getDateGroup(n.createdAt, now);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(n);
  }

  return ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
}

export function NotificationList() {
  const t = useTranslations('notifications');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const now = React.useMemo(() => new Date(), []);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterValue | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string, replace = false) => {
      try {
        const result = await listNotifications({
          filter: activeFilter,
          unread: unreadOnly || undefined,
          cursor,
          limit: 20,
        });
        setNotifications((prev) => (replace ? result.data : [...prev, ...result.data]));
        setNextCursor(result.nextCursor);
        setError(null);
      } catch {
        setError(t('errorLoad'));
      }
    },
    [activeFilter, unreadOnly, t],
  );

  useEffect(() => {
    setLoading(true);
    fetchPage(undefined, true).finally(() => setLoading(false));
  }, [fetchPage]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchPage(nextCursor, false);
    setLoadingMore(false);
  };

  const handleMarkRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)),
    );
    markNotificationsRead([id]).catch(() => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false, readAt: null } : n)),
      );
    });
  }, []);

  const handleMarkAllRead = async () => {
    const prevState = notifications.map((n) => ({ ...n }));
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })),
    );
    try {
      await markAllNotificationsRead();
    } catch {
      setNotifications(prevState);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const groups = groupByDate(notifications, now);

  const emptyKind: 'all' | 'filter' | 'unread' = unreadOnly
    ? 'unread'
    : activeFilter
      ? 'filter'
      : 'all';

  /** Clears every narrowing control at once, from the empty state. */
  const resetFilters = () => {
    setActiveFilter(undefined);
    setUnreadOnly(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <NotificationFilters
        activeFilter={activeFilter}
        unreadOnly={unreadOnly}
        onFilterChange={(f) => setActiveFilter(f)}
        onUnreadToggle={(u) => setUnreadOnly(u)}
      />

      {/*
        Status bar. Rendered at a FIXED height whether or not anything is unread —
        previously "Mark all as read" appeared and vanished, shunting the whole
        feed up and down as the last item was read.
      */}
      <div className="flex min-h-[2rem] items-center justify-between gap-3">
        {unreadCount > 0 ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
            <span className="size-1.5 rounded-full bg-primary-600" aria-hidden="true" />
            {t('unreadCount', { count: unreadCount })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-neutral-600">
            <CheckCheck className="size-4 text-success-fg" aria-hidden="true" />
            {t('allCaughtUp')}
          </span>
        )}

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="inline-flex min-h-[2rem] items-center rounded-lg px-2 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('markAllRead')}
          </button>
        )}
      </div>

      {loading ? (
        <NotificationSkeleton label={t('loading')} />
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-2xl border border-error-fg/20 bg-error-bg px-6 py-12 text-center"
        >
          <AlertCircle className="size-8 text-error-fg" aria-hidden="true" />
          <p className="text-sm font-medium text-error-fg">{error}</p>
          <button
            type="button"
            onClick={() => fetchPage(undefined, true)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-error-fg/30 bg-white px-5 text-sm font-semibold text-error-fg transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <NotificationEmptyState
          kind={emptyKind}
          title={t(`emptyTitles.${emptyKind}` as Parameters<typeof t>[0])}
          // The original one-line copy stays the BODY for the filtered/unread
          // cases; only the true-empty feed gets the fuller explanation.
          body={emptyKind === 'all' ? t('empty.allBody') : t(`empty.${emptyKind}`)}
          action={
            emptyKind === 'all'
              ? { label: t('actionBrowseJobs'), href: `/${locale}/jobs` }
              : { label: t('actionShowAll'), onClick: resetFilters }
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, items }) => (
            <section key={group} aria-labelledby={`group-${group}`}>
              <h2
                id={`group-${group}`}
                className="text-xs font-semibold text-neutral-600 uppercase tracking-wide mb-2 px-1"
              >
                {t(`dateGroups.${group}` as Parameters<typeof t>[0])}
              </h2>
              <div
                className={cn(
                  'bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden',
                )}
              >
                {items.map((n) => (
                  <NotificationItem key={n.id} notification={n} onMarkRead={handleMarkRead} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 focus-visible:outline-none focus-visible:underline"
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

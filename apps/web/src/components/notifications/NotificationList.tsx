'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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

  const emptyKey = unreadOnly ? 'unread' : activeFilter ? 'filter' : 'all';

  return (
    <div className="flex flex-col gap-4">
      <NotificationFilters
        activeFilter={activeFilter}
        unreadOnly={unreadOnly}
        onFilterChange={(f) => setActiveFilter(f)}
        onUnreadToggle={(u) => setUnreadOnly(u)}
      />

      {unreadCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="text-sm text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline"
          >
            {t('markAllRead')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-neutral-400">
          {t('loading')}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-sm text-neutral-500">{error}</p>
          <button
            type="button"
            onClick={() => fetchPage(undefined, true)}
            className="text-sm text-primary-600 underline"
          >
            {t('retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {t(`empty.${emptyKey}` as Parameters<typeof t>[0])}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, items }) => (
            <section key={group} aria-labelledby={`group-${group}`}>
              <h2
                id={`group-${group}`}
                className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 px-1"
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

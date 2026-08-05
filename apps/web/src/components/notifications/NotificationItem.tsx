'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';
import { notificationMeta, fallbackNotificationMeta } from '@/lib/notifications/notificationMeta';

type Notification = components['schemas']['Notification'];

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

/**
 * Localised relative time.
 *
 * This used to return hardcoded English ("Just now", "5m ago", "3d ago") on a
 * screen that ships Hindi and Arabic, so every timestamp in the feed stayed in
 * English. Intl.RelativeTimeFormat renders in the ACTIVE locale and handles
 * plural rules per language, which a template string cannot.
 */
function formatRelativeTime(isoDate: string, locale: string, justNow: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return justNow;

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');

  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');

  return rtf.format(-Math.floor(hours / 24), 'day');
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const t = useTranslations('notifications');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  // Fall back gracefully if the API ever sends a type not in the map (prevents
  // a single unknown notification from crashing the whole feed).
  const meta = notificationMeta[notification.type] ?? fallbackNotificationMeta;
  const { Icon, colorClass, bgClass, routeFn } = meta;
  const route = routeFn?.(notification.relatedEntityId, notification.relatedEntityType);
  const href = route ? `/${locale}${route}` : undefined;

  const inner = (
    <div
      className={cn(
        // The accent bar is always present, transparent when read, so marking a
        // row read re-colours it instead of shifting its content sideways.
        'flex items-start gap-3 border-s-2 px-4 py-3.5 transition-colors',
        notification.read ? 'border-transparent bg-white' : 'border-primary-600 bg-primary-50/50',
        href && 'hover:bg-neutral-50',
      )}
    >
      <span
        className={cn(
          'flex-none mt-0.5 size-9 rounded-full flex items-center justify-center',
          bgClass,
        )}
      >
        <Icon className={cn('size-4', colorClass)} aria-hidden="true" />
      </span>

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm font-medium leading-snug',
            notification.read ? 'text-neutral-700' : 'text-neutral-900',
          )}
        >
          {notification.title}
        </p>
        <p className="text-sm text-neutral-600 mt-0.5 leading-snug">{notification.body}</p>
        <time dateTime={notification.createdAt} className="mt-1 block text-xs text-neutral-600">
          {formatRelativeTime(notification.createdAt, locale, t('justNow'))}
        </time>
      </div>

      <div className="ms-2 flex flex-none items-center gap-1.5">
        {!notification.read && (
          <>
            <span className="size-2 flex-none rounded-full bg-primary-600" aria-label="Unread" />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarkRead(notification.id);
              }}
              className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-lg px-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-white hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              aria-label={t('markRead')}
            >
              {t('markRead')}
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-lg"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

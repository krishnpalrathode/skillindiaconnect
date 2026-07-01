'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';
import { notificationMeta } from '@/lib/notifications/notificationMeta';

type Notification = components['schemas']['Notification'];

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? 'Just now' : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const t = useTranslations('notifications');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const meta = notificationMeta[notification.type];
  const { Icon, colorClass, bgClass, routeFn } = meta;
  const route = routeFn?.(notification.relatedEntityId, notification.relatedEntityType);
  const href = route ? `/${locale}${route}` : undefined;

  const inner = (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-lg transition-colors',
        notification.read ? 'bg-white' : 'bg-primary-50/40',
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
        <p className="text-sm text-neutral-500 mt-0.5 leading-snug">{notification.body}</p>
        <p className="text-xs text-neutral-400 mt-1">
          {formatRelativeTime(notification.createdAt)}
        </p>
      </div>

      <div className="flex-none flex items-center gap-2 ms-2">
        {!notification.read && (
          <>
            <span className="size-2 rounded-full bg-primary-500 flex-none" aria-label="Unread" />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarkRead(notification.id);
              }}
              className="text-xs text-neutral-400 hover:text-primary-600 transition-colors focus-visible:outline-none focus-visible:underline whitespace-nowrap"
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

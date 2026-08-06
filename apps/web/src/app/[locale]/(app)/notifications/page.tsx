'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList } from '@/components/notifications/NotificationList';
import { PAGE_SHELL } from '@/lib/page-shell';

export default function NotificationsPage() {
  const t = useTranslations('notifications');

  return (
    <div className={PAGE_SHELL}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t('pageTitle')}</h1>
        {/* Says what this feed is FOR — the screen previously opened with a bare
            title above an empty page, explaining nothing. */}
        <p className="text-sm leading-relaxed text-neutral-600">{t('subtitle')}</p>
      </header>

      <NotificationList />
    </div>
  );
}

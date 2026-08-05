'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList } from '@/components/notifications/NotificationList';

export default function NotificationsPage() {
  const t = useTranslations('notifications');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:py-8">
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

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList } from '@/components/notifications/NotificationList';

export default function NotificationsPage() {
  const t = useTranslations('notifications');

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('pageTitle')}</h1>
      <NotificationList />
    </div>
  );
}

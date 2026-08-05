'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList } from '@/components/notifications/NotificationList';
import { employerNotificationsApi } from '@/lib/api/notifications';

export default function EmployerNotificationsPage() {
  const t = useTranslations('notifications');

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('pageTitle')}</h1>
      <NotificationList api={employerNotificationsApi} />
    </div>
  );
}

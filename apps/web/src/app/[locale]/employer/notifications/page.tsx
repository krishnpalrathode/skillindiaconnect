'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList } from '@/components/notifications/NotificationList';
import { employerNotificationsApi } from '@/lib/api/notifications';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

export default function EmployerNotificationsPage() {
  const t = useTranslations('notifications');

  return (
    <div className={EMPLOYER_PAGE_SHELL}>
      <h1 className="text-xl font-bold text-neutral-900">{t('pageTitle')}</h1>
      <NotificationList api={employerNotificationsApi} />
    </div>
  );
}

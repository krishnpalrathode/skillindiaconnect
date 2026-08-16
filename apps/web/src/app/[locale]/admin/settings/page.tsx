'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { SettingsTabs } from '@/components/admin/settings/SettingsTabs';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

/** Screen 28 — platform settings (replaces the S6a-F1 placeholder). */
export default function AdminSettingsPage() {
  const t = useTranslations('admin.settings');

  return (
    <div className={ADMIN_PAGE_SHELL}>
      <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
      <SettingsTabs />
    </div>
  );
}

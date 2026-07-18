'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { SettingsTabs } from '@/components/admin/settings/SettingsTabs';

/** Screen 28 — platform settings (replaces the S6a-F1 placeholder). */
export default function AdminSettingsPage() {
  const t = useTranslations('admin.settings');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
      <SettingsTabs />
    </div>
  );
}

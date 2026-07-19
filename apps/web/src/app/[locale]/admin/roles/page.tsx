'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { PermissionMatrix } from '@/components/admin/roles/PermissionMatrix';

/** Screen 27 — the RBAC matrix editor (replaces the S6a-F1 placeholder). */
export default function AdminRolesPage() {
  const t = useTranslations('admin.roles');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>
      <PermissionMatrix />
    </div>
  );
}

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { OnBehalfJobForm } from '@/components/admin/jobs/OnBehalfJobForm';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { ForbiddenState } from '@/components/admin/ForbiddenState';

/**
 * On-behalf posting (minimal). Hiding the form is UX; the server's
 * jobs.post_admin 403 is the authority for a forced URL.
 */
export default function AdminJobNewPage() {
  const t = useTranslations('admin.jobs.onBehalf');
  return (
    <PermissionGate
      permission="jobs.post_admin"
      fallback={<ForbiddenState requiredPermission="jobs.post_admin" />}
    >
      <div className="flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
        </div>
        <OnBehalfJobForm />
      </div>
    </PermissionGate>
  );
}

'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { AdminApplicationsTable } from '@/components/admin/applications/AdminApplicationsTable';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

/** Screen 26 — the global application explorer. Replaces the S6a-F1 placeholder. */
export default function AdminApplicationsPage() {
  const t = useTranslations('admin.applications');
  return (
    <div className={ADMIN_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <AdminApplicationsTable />
      </Suspense>
    </div>
  );
}

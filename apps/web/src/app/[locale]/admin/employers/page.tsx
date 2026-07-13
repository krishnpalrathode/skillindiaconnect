'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { EmployerQueueTable } from '@/components/admin/employers/EmployerQueueTable';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Screen 24 — the employer approval queue (replaces the S6a-F1 placeholder).
 * Suspense: EmployerQueueTable reads useSearchParams (the ?status= deep link).
 */
export default function AdminEmployersPage() {
  const t = useTranslations('admin.employers');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <EmployerQueueTable />
      </Suspense>
    </div>
  );
}

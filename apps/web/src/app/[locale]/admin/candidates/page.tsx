'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { CandidateTable } from '@/components/admin/candidates/CandidateTable';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

/** Screen 25 — candidate management. Replaces the S6a-F1 placeholder. */
export default function AdminCandidatesPage() {
  const t = useTranslations('admin.candidates');
  return (
    <div className={ADMIN_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <CandidateTable />
      </Suspense>
    </div>
  );
}

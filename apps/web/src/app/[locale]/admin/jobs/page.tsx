'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { AdminJobsTable } from '@/components/admin/jobs/AdminJobsTable';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { Skeleton } from '@/components/ui/skeleton';

/** Jobs moderation — list + the PENDING_REVIEW queue. Replaces the S6a-F1 placeholder. */
export default function AdminJobsPage() {
  const t = useTranslations('admin.jobs');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
        </div>
        <PermissionGate permission="jobs.post_admin">
          <Link
            href={`/${locale}/admin/jobs/new`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('postOnBehalf')}
          </Link>
        </PermissionGate>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <AdminJobsTable />
      </Suspense>
    </div>
  );
}

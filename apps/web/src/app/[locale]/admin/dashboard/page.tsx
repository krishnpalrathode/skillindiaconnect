'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { AnalyticsDashboard } from '@/components/admin/analytics/AnalyticsDashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

/**
 * Screen 22 — the admin overview.
 *
 * The KPI/queue tiles that used to live here are now the top two bands of
 * AnalyticsDashboard, scoped by one shared date range: an admin comparing "new
 * candidates" against "applications" needs both to be measured over the same
 * window, which the old two-source layout could not guarantee.
 *
 * Suspense: AnalyticsDashboard reads `?days=` via useSearchParams, which opts the
 * route into client rendering unless it's suspended.
 */
export default function AdminDashboardPage() {
  const t = useTranslations('admin.dashboard');

  return (
    <div className={ADMIN_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  );
}

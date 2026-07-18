'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getAdminDashboard, type AdminDashboard } from '@/lib/api/admin';
import { ApiRequestError } from '@/lib/api/client';
import { AdminKpis } from '@/components/admin/dashboard/AdminKpis';
import { QueueCards } from '@/components/admin/dashboard/QueueCards';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const t = useTranslations('admin.dashboard');
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getAdminDashboard());
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <DashboardSkeleton />;

  // A 403 is not a failure to be retried — it is a definitive answer. The nav
  // should already have hidden this, but a forced URL lands here, and the SERVER
  // is what actually decided. Render its answer honestly.
  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  // Anything else genuinely might be transient — offer the retry. Never render a
  // dashboard of zeros on a failed fetch: "0 pending reviews" and "we couldn't
  // ask" look identical and mean opposite things.
  if (error || !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-12">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
      {/* Queues FIRST — the work waiting on a human outranks the statistics. */}
      <QueueCards data={data} />
      <AdminKpis data={data} />
    </div>
  );
}

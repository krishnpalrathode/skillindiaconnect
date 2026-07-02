'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { MyJobsTable } from '@/components/employer/myjobs/MyJobsTable';

export default function MyJobsPage() {
  const t = useTranslations('myjobs');
  const searchParams = useSearchParams();
  const toastRef = useRef<HTMLDivElement>(null);

  const published = searchParams?.get('published');

  useEffect(() => {
    if (published && toastRef.current) {
      toastRef.current.focus();
    }
  }, [published]);

  return (
    <div className="max-w-6xl flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('pageTitle')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('pageSubtitle')}</p>
        </div>
      </div>

      {published && (
        <div
          ref={toastRef}
          role="status"
          tabIndex={-1}
          aria-live="polite"
          className="rounded-lg border border-success-fg/30 bg-success-bg px-4 py-3 text-sm font-medium text-success-fg"
        >
          {t('publishSuccess')}
        </div>
      )}

      <MyJobsTable />
    </div>
  );
}

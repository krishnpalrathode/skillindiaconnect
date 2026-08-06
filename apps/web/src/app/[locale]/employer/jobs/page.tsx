'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { MyJobsTable } from '@/components/employer/myjobs/MyJobsTable';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

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
    <div className={EMPLOYER_PAGE_SHELL}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            {t('pageTitle')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('pageSubtitle')}</p>
        </div>
      </div>

      {published && (
        <div
          ref={toastRef}
          role="status"
          tabIndex={-1}
          aria-live="polite"
          className="rounded-2xl border border-success-fg/25 bg-success-bg px-5 py-4 text-sm font-medium text-success-fg shadow-sm"
        >
          {t('publishSuccess')}
        </div>
      )}

      <MyJobsTable />
    </div>
  );
}

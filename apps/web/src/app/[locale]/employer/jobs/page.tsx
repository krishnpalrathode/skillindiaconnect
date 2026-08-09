'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { MyJobsTable } from '@/components/employer/myjobs/MyJobsTable';
import { useToast } from '@/components/ui/toast';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

export default function MyJobsPage() {
  const t = useTranslations('myjobs');
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  // Guards against re-announcing on a re-render or a manual refresh — the
  // `published` param stays in the URL after the redirect that set it.
  const announced = useRef(false);

  const published = searchParams?.get('published');

  useEffect(() => {
    if (!published || announced.current) return;
    announced.current = true;
    showToast({ message: t('publishSuccess') });
    // `t` and `showToast` are stable enough for this one-shot, and the ref
    // above is the real re-entry guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* The publish confirmation used to be a bespoke green panel here. It is
          now the shared toast (fired above) so every job action — publish,
          pause, resume, close, duplicate — confirms the same way. */}
      <MyJobsTable />
    </div>
  );
}

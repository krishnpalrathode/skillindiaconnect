'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { RecommendedJobCard } from './RecommendedJobCard';

type JobCardType = components['schemas']['JobCard'];

interface RecommendedJobsProps {
  jobs: JobCardType[];
}

export function RecommendedJobs({ jobs }: RecommendedJobsProps) {
  const t = useTranslations('dashboard.recommendedJobs');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  return (
    <section aria-labelledby="recommended-jobs-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="recommended-jobs-heading" className="text-lg font-bold text-neutral-900">
          {t('title')}
        </h2>
        <Link
          href={`/${locale}/jobs`}
          className="rounded text-sm font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('viewAll')}
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200/70 bg-white px-4 py-8 text-center text-sm text-neutral-600 shadow-sm">
          {t('empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t('title')}>
          {jobs.map((job) => (
            <li key={job.id}>
              <RecommendedJobCard job={job} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

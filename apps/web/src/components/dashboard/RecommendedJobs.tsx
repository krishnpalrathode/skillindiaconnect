'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { JobCard } from '@/components/jobs/JobCard';

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
      <div className="flex items-center justify-between mb-3">
        <h2 id="recommended-jobs-heading" className="text-base font-semibold text-neutral-900">
          {t('title')}
        </h2>
        <Link
          href={`/${locale}/jobs`}
          className="text-sm text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline"
        >
          {t('viewAll')}
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-neutral-500 py-4">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('title')}>
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

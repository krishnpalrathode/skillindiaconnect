'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { JobCard } from './JobCard';
import { Button } from '@/components/ui/button';
import {
  searchJobsClient,
  type JobCard as JobCardType,
  type JobSearchResult,
} from '@/lib/api/jobs';
import { DEFAULT_PAGE_SIZE, type JobSearchFilters } from '@/lib/jobs/searchParams';

interface JobListProps {
  initialData: JobSearchResult;
  filters: JobSearchFilters;
  locale: string;
}

/**
 * Renders the SSR-fetched first page, then fetches subsequent pages
 * client-side on "Load more". The parent (page.tsx) must remount this
 * component (via a `key` keyed on the filter query string) whenever filters
 * change — otherwise this component's local `jobs`/`cursor` state would keep
 * the stale previous-filter results instead of picking up the new SSR page.
 */
export function JobList({ initialData, filters, locale }: JobListProps) {
  const t = useTranslations('jobs');
  const [jobs, setJobs] = useState<JobCardType[]>(initialData.data);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(false);
    try {
      const result = await searchJobsClient(filters, { cursor, limit: DEFAULT_PAGE_SIZE });
      setJobs((prev) => [...prev, ...result.data]);
      setCursor(result.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 py-16 text-center">
        <p className="text-base font-medium text-neutral-700">{t('empty.title')}</p>
        <p className="text-sm text-neutral-500">{t('empty.body')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-500" data-testid="job-result-count">
        {t('resultCount', { count: jobs.length })}
      </p>

      <ul
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label={t('resultsLabel')}
      >
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} locale={locale} />
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <Button type="button" variant="outline" onClick={loadMore} loading={loading}>
            {t('loadMore')}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-error-fg">
              {t('loadMoreError')}{' '}
              <button
                type="button"
                onClick={loadMore}
                className="underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
              >
                {t('retry')}
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

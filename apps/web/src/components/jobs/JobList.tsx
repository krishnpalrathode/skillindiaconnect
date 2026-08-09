'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { JobCard } from './JobCard';
import { Pagination } from '@/components/ui/pagination';
import { type JobCard as JobCardType, type JobSearchResult } from '@/lib/api/jobs';
import { buildJobSearchQuery, type JobSearchFilters } from '@/lib/jobs/searchParams';

interface JobListProps {
  data: JobSearchResult;
  filters: JobSearchFilters;
  locale: string;
}

/**
 * Renders one SSR-fetched page of results.
 *
 * Paging is URL-driven rather than local state: the page number lives in the
 * query string, so the server renders the requested page directly (crawlable,
 * no CLS, no client refetch) and Back/Forward and link-sharing land on the same
 * results the user was looking at.
 */
export function JobList({ data, filters, locale }: JobListProps) {
  const t = useTranslations('jobs');
  const router = useRouter();
  const pathname = usePathname();

  const jobs: JobCardType[] = data.data;
  const { page, totalPages, total } = data.meta;

  const goToPage = (next: number) => {
    const qs = buildJobSearchQuery(filters, { page: next });
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 py-16 text-center">
        <p className="text-base font-medium text-neutral-700">{t('empty.title')}</p>
        <p className="text-sm text-neutral-600">{t('empty.body')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Counts the whole result set, not just this page — `total` is what the
          user is actually filtering down. */}
      <p className="text-sm text-neutral-600" data-testid="job-result-count">
        {t('resultCount', { count: total })}
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

      <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />
    </div>
  );
}

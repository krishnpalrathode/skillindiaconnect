'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Search, PlusCircle, Briefcase } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { JobStatusBadge } from './JobStatusBadge';
import { JobRowActions } from './JobRowActions';
import { listMyJobs, type Job, type JobStatus } from '@/lib/api/jobs-employer';
import { formatPostedAgo } from '@/lib/jobs/format';

const STATUS_TABS: Array<{ value: JobStatus | 'ALL'; labelKey: string }> = [
  { value: 'ALL', labelKey: 'all' },
  { value: 'ACTIVE', labelKey: 'active' },
  { value: 'PAUSED', labelKey: 'paused' },
  { value: 'DRAFT', labelKey: 'draft' },
  { value: 'ARCHIVED', labelKey: 'archived' },
];

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function MyJobsTable() {
  const t = useTranslations('myjobs');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);
  const pageSize = 20;

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const result = await listMyJobs({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      });
      setJobs(result.data);
      setTotalCount(result.meta.total);
    } catch {
      setError(t('loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, debouncedSearch, page, t]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleJobUpdated = (updated: Job) => {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
  };

  const handleJobCreated = (created: Job) => {
    setJobs((prev) => [created, ...prev]);
    setTotalCount((c) => c + 1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex flex-col gap-4">
      {/* Search + Post CTA row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-neutral-400 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="ps-9"
          />
        </div>
        <Link
          href={`/${locale}/employer/jobs/new`}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 shrink-0 min-h-[44px]"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('postNewJob')}
        </Link>
      </div>

      {/* Status filter tabs */}
      <div
        role="tablist"
        aria-label={t('statusFilterLabel')}
        className="flex gap-0.5 border-b border-neutral-200 overflow-x-auto"
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={statusFilter === tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
              statusFilter === tab.value
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t(`tabs.${tab.labelKey}`)}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16" aria-live="polite" aria-busy="true">
          <Spinner size={28} label={t('loading')} />
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div role="alert" className="py-8 text-center">
          <p className="text-sm text-error-fg">{error}</p>
          <Button variant="outline" size="sm" onClick={load} className="mt-3">
            {t('retry')}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <div className="size-14 rounded-full bg-neutral-100 flex items-center justify-center">
            <Briefcase className="size-7 text-neutral-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-neutral-700">{t('emptyTitle')}</p>
            <p className="text-sm text-neutral-400 mt-1">{t('emptyBody')}</p>
          </div>
          <Link
            href={`/${locale}/employer/jobs/new`}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <PlusCircle className="size-4" aria-hidden="true" />
            {t('postFirstJob')}
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full min-w-[640px] text-sm" aria-label={t('tableLabel')}>
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr>
                <th scope="col" className="text-start px-4 py-3 font-semibold text-neutral-700">
                  {t('col.title')}
                </th>
                <th scope="col" className="text-start px-3 py-3 font-semibold text-neutral-700">
                  {t('col.market')}
                </th>
                <th scope="col" className="text-start px-3 py-3 font-semibold text-neutral-700">
                  {t('col.status')}
                </th>
                <th scope="col" className="text-start px-3 py-3 font-semibold text-neutral-700">
                  {t('col.applications')}
                </th>
                <th scope="col" className="text-start px-3 py-3 font-semibold text-neutral-700">
                  {t('col.posted')}
                </th>
                <th scope="col" className="text-start px-3 py-3 font-semibold text-neutral-700">
                  {t('col.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900 leading-snug">{job.title}</p>
                    <p className="text-xs text-neutral-400">{job.location}</p>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
                      {job.market === 'GULF' ? t('marketGulf') : t('marketLocal')}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-3 py-3">
                    {/* S2 placeholder — applications are S4 */}
                    <span
                      className="text-neutral-400 text-sm"
                      aria-label={t('applicationsPlaceholder')}
                    >
                      0
                    </span>
                  </td>
                  <td className="px-3 py-3 text-neutral-500">
                    {job.publishedAt
                      ? formatPostedAgo(job.publishedAt, locale)
                      : job.status === 'DRAFT'
                        ? t('draftNotPosted')
                        : formatPostedAgo(job.createdAt, locale)}
                  </td>
                  <td className="px-3 py-3">
                    <JobRowActions
                      job={job}
                      onJobUpdated={handleJobUpdated}
                      onJobCreated={handleJobCreated}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>{t('pageInfo', { page, totalPages })}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label={t('previousPage')}
            >
              {t('prev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t('nextPage')}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

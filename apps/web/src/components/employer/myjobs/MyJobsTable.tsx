'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Search, PlusCircle, Briefcase } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BrandLoader } from '@/components/ui/brand-loader';
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
    // A lifecycle action can move a job out of the tab you are looking at —
    // archive one from "Active" and leaving the row in place claims it is
    // still active. Drop it from a filtered view; on "All" it stays and just
    // shows its new badge.
    //
    // Both setState calls sit HERE rather than inside the setJobs updater: an
    // updater runs during React's render phase, and queueing another
    // component's update from inside one is the "Cannot update a component
    // while rendering a different component" warning.
    const stillMatches = statusFilter === 'ALL' || updated.status === statusFilter;
    if (stillMatches) {
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      return;
    }
    setJobs((prev) => prev.filter((j) => j.id !== updated.id));
    setTotalCount((c) => Math.max(0, c - 1));
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
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-600 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="ps-10 rounded-xl"
          />
        </div>
        <Link
          href={`/${locale}/employer/jobs/new`}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white text-sm font-semibold shadow-md shadow-[#0F3D91]/20 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 shrink-0 min-h-[44px]"
        >
          <PlusCircle className="size-4" aria-hidden="true" />
          {t('postNewJob')}
        </Link>
      </div>

      {/* Status filter tabs */}
      <div
        role="tablist"
        aria-label={t('statusFilterLabel')}
        className="flex gap-1 overflow-x-auto rounded-xl bg-white/70 p-1 ring-1 ring-neutral-200/70"
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={statusFilter === tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
              statusFilter === tab.value
                ? 'bg-[#0F3D91] text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-[#0F3D91]'
            }`}
          >
            {t(`tabs.${tab.labelKey}`)}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16" aria-live="polite" aria-busy="true">
          <BrandLoader size="md" label={t('loading')} />
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
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-neutral-200/70 bg-white/90 py-16 text-center shadow-sm">
          <div
            className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#EEF3FB] to-[#E8F0FE] text-[#0F3D91] ring-8 ring-[#F5F8FC]"
            aria-hidden="true"
          >
            <Briefcase className="size-9" />
          </div>
          <div>
            <p className="text-lg font-semibold text-neutral-900">{t('emptyTitle')}</p>
            <p className="mt-1 text-sm text-neutral-600">{t('emptyBody')}</p>
          </div>
          <Link
            href={`/${locale}/employer/jobs/new`}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white text-sm font-semibold shadow-md shadow-[#0F3D91]/20 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <PlusCircle className="size-4" aria-hidden="true" />
            {t('postFirstJob')}
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200/70 bg-white/90 shadow-sm backdrop-blur-sm">
          <table className="w-full min-w-[640px] text-sm" aria-label={t('tableLabel')}>
            <thead className="bg-neutral-50/80 border-b border-neutral-200">
              <tr>
                <th
                  scope="col"
                  className="text-start px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.title')}
                </th>
                <th
                  scope="col"
                  className="text-start px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.market')}
                </th>
                <th
                  scope="col"
                  className="text-start px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.status')}
                </th>
                <th
                  scope="col"
                  className="text-start px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.applications')}
                </th>
                <th
                  scope="col"
                  className="text-start px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.posted')}
                </th>
                <th
                  scope="col"
                  className="text-start px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {t('col.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {jobs.map((job) => (
                <tr key={job.id} className="transition-colors hover:bg-neutral-50/70">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-neutral-900 leading-snug">{job.title}</p>
                    <p className="mt-0.5 text-xs text-neutral-600">{job.location}</p>
                  </td>
                  <td className="px-3 py-4">
                    <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
                      {job.market === 'GULF' ? t('marketGulf') : t('marketLocal')}
                    </Badge>
                  </td>
                  <td className="px-3 py-4">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-3 py-4">
                    {/* S4-F3: live applicant count → the job's pipeline (Screen 18). */}
                    <Link
                      href={`/${locale}/employer/jobs/${job.id}/applicants`}
                      className="inline-flex min-h-11 items-center gap-1 rounded font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                      aria-label={t('applicantsCountLabel', { count: job.applicantCount ?? 0 })}
                    >
                      {job.applicantCount ?? 0}
                    </Link>
                  </td>
                  <td className="px-3 py-4 text-neutral-600">
                    {job.publishedAt
                      ? formatPostedAgo(job.publishedAt, locale)
                      : job.status === 'DRAFT'
                        ? t('draftNotPosted')
                        : formatPostedAgo(job.createdAt, locale)}
                  </td>
                  <td className="px-3 py-4">
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
        <div className="flex items-center justify-between rounded-2xl border border-neutral-200/70 bg-white/90 px-5 py-3 text-sm text-neutral-600 shadow-sm">
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

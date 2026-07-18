'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  listAdminJobs,
  type AdminJobRow,
  type JobListMeta,
  type JobStatus,
} from '@/lib/api/admin-jobs';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { JobStatusBadge } from '@/components/employer/myjobs/JobStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ReviewQueueBanner } from './ReviewQueueBanner';

/**
 * The admin jobs list — EVERY status (DRAFT and PENDING_REVIEW included, which
 * no employer-facing or public list returns; that is what makes the moderation
 * queue possible). The dashboard's "Pending job reviews" card deep-links here
 * with ?status=PENDING_REVIEW and MUST land filtered — filters live in the URL
 * (native history, the S6a-F2 lesson).
 */
const STATUS_TABS = ['ALL', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export function AdminJobsTable() {
  const t = useTranslations('admin.jobs.table');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const statusParam = (searchParams.get('status') ?? 'ALL').toUpperCase();
  const activeTab: StatusTab = (STATUS_TABS as readonly string[]).includes(statusParam)
    ? (statusParam as StatusTab)
    : 'ALL';
  const flag = searchParams.get('flag') ?? '';
  const search = searchParams.get('search') ?? '';
  const employerId = searchParams.get('employerId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [rows, setRows] = useState<AdminJobRow[] | null>(null);
  const [meta, setMeta] = useState<JobListMeta | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      // NATIVE history: a filter change is pure client state; router.replace
      // fires an RSC fetch that dies under MSW and drops the in-memory token.
      const qs = next.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const result = await listAdminJobs({
        status: activeTab === 'ALL' ? undefined : (activeTab as JobStatus),
        featured: flag === 'featured' ? true : undefined,
        urgent: flag === 'urgent' ? true : undefined,
        search: search || undefined,
        employerId: employerId || undefined,
        page,
      });
      setRows(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err as Error);
    }
  }, [activeTab, flag, search, employerId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReviewQueueBanner
        activeFilter={activeTab === 'PENDING_REVIEW'}
        onShowQueue={() => setParam('status', 'PENDING_REVIEW')}
      />

      {/* Status tabs */}
      <div role="tablist" aria-label={t('statusFilterLabel')} className="flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setParam('status', tab === 'ALL' ? null : tab)}
            className={cn(
              'min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              activeTab === tab
                ? 'bg-primary-50 font-semibold text-primary-700'
                : 'text-neutral-600 hover:bg-neutral-100',
            )}
          >
            {t(`statusTab.${tab}`)}
          </button>
        ))}
      </div>

      {/* Flags filter + search (title / company) */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          {t('flagFilterLabel')}
          <select
            value={flag}
            onChange={(e) => setParam('flag', e.target.value || null)}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="">{t('flagAny')}</option>
            <option value="featured">{t('flagFeatured')}</option>
            <option value="urgent">{t('flagUrgent')}</option>
          </select>
        </label>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('search', searchDraft.trim() || null);
          }}
        >
          <label htmlFor="admin-jobs-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="admin-jobs-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="min-h-[44px] w-72 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
          <Button type="submit" variant="outline" size="sm">
            <Search className="size-4" aria-hidden="true" />
            {t('searchButton')}
          </Button>
        </form>

        {employerId && (
          <Button variant="outline" size="sm" onClick={() => setParam('employerId', null)}>
            {t('clearEmployerFilter')}
          </Button>
        )}
      </div>

      {rows === null && !error && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && !(error instanceof ApiRequestError && error.error.status === 403) && (
        <div role="alert" className="flex flex-col items-start gap-3 py-8">
          <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p role="status" className="py-10 text-center text-sm text-neutral-500">
          {t(`empty.${activeTab}`)}
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead>
              <tr className="border-b border-neutral-200">
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.job')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.company')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.market')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.status')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.flags')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.applicants')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.views')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.posted')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/${locale}/admin/jobs/${j.id}`}
                      aria-label={t('detailAria', { title: j.title })}
                      className="font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
                    >
                      {j.title}
                    </Link>
                    <p className="text-xs text-neutral-500">{j.humanId}</p>
                  </td>
                  <td className="p-3 text-neutral-600">{j.companyName}</td>
                  <td className="p-3 text-neutral-600">{j.market ?? '—'}</td>
                  <td className="p-3">
                    <JobStatusBadge status={j.status} />
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {j.isFeatured && <Badge variant="primary">{t('featuredChip')}</Badge>}
                      {j.isUrgent && <Badge variant="accent">{t('urgentChip')}</Badge>}
                      {!j.isFeatured && !j.isUrgent && <span className="text-neutral-400">—</span>}
                    </div>
                  </td>
                  <td className="p-3 text-neutral-600">{j.applicantCount ?? 0}</td>
                  <td className="p-3 text-neutral-600">{j.views ?? 0}</td>
                  <td className="p-3 text-neutral-600">
                    {new Date(j.publishedAt ?? j.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label={t('paginationLabel')} className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
          >
            {t('prevPage')}
          </Button>
          <span className="text-sm text-neutral-600">
            {t('pageOf', { page: meta.page, total: meta.totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setParam('page', String(page + 1))}
          >
            {t('nextPage')}
          </Button>
        </nav>
      )}
    </div>
  );
}

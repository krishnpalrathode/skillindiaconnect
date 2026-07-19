'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  listAdminApplications,
  type AdminApplicationRow,
  type ApplicationListMeta,
  type ApplicationStatus,
} from '@/lib/api/admin-applications';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Admin-context status colors — same palette semantics as the candidate card. */
export const ADMIN_APP_STATUS_VARIANT: Record<
  ApplicationStatus,
  'success' | 'info' | 'error' | 'neutral'
> = {
  PENDING: 'neutral',
  SHORTLISTED: 'info',
  SELECTED: 'success',
  REJECTED: 'error',
};

/**
 * Screen 26's global list — cross-job, cross-employer (unlike the S4-F3
 * per-job applicants pipeline, which stays the employer's surface). Rows carry
 * the OVERRIDE INDICATOR: `overrideReason` non-null means an admin has made a
 * corrective move on this application — the record this screen exists to show.
 */
const STATUS_TABS = ['ALL', 'PENDING', 'SHORTLISTED', 'SELECTED', 'REJECTED'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export function AdminApplicationsTable() {
  const t = useTranslations('admin.applications.table');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const statusParam = (searchParams.get('status') ?? 'ALL').toUpperCase();
  const activeTab: StatusTab = (STATUS_TABS as readonly string[]).includes(statusParam)
    ? (statusParam as StatusTab)
    : 'ALL';
  const jobId = searchParams.get('jobId') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [rows, setRows] = useState<AdminApplicationRow[] | null>(null);
  const [meta, setMeta] = useState<ApplicationListMeta | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      // NATIVE history (S6a-F2 lesson) — no RSC refetch under MSW.
      const qs = next.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const result = await listAdminApplications({
        status: activeTab === 'ALL' ? undefined : (activeTab as ApplicationStatus),
        jobId: jobId || undefined,
        search: search || undefined,
        page,
      });
      setRows(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err as Error);
    }
  }, [activeTab, jobId, search, page]);

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

      {/* Search + job filter chip */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('search', searchDraft.trim() || null);
          }}
        >
          <label htmlFor="admin-apps-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="admin-apps-search"
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

        {jobId && (
          <Button variant="outline" size="sm" onClick={() => setParam('jobId', null)}>
            {t('clearJobFilter')}
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
        <p role="status" className="py-10 text-center text-sm text-neutral-600">
          {t('empty')}
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead>
              <tr className="border-b border-neutral-200">
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.application')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.candidate')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.job')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.status')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.match')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.applied')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/${locale}/admin/applications/${a.id}`}
                      aria-label={t('detailAria', { id: a.humanId })}
                      className="font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
                    >
                      {a.humanId}
                    </Link>
                  </td>
                  <td className="p-3 text-neutral-900">
                    {a.candidateName ?? (
                      <span className="text-neutral-600">{t('deletedUser')}</span>
                    )}
                  </td>
                  <td className="p-3 text-neutral-600">{a.jobTitle ?? '—'}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={ADMIN_APP_STATUS_VARIANT[a.status]}>
                        {t(`status.${a.status}`)}
                      </Badge>
                      {/* THE OVERRIDE INDICATOR — an admin has corrected this record. */}
                      {a.overrideReason != null && (
                        <Badge variant="warning">{t('overrideChip')}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-neutral-600">{a.matchScore}</td>
                  <td className="p-3 text-neutral-600">
                    {new Date(a.appliedAt).toLocaleDateString('en-IN', {
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

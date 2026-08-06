'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  listCandidates,
  type AdminCandidateCard,
  type CandidateListMeta,
  type UserStatus,
} from '@/lib/api/admin-candidates';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format/date';
import { CandidateStatusBadge, accountState } from './CandidateStatusBadge';
import { daysUntil } from './DeletionStateBanner';

/**
 * Screen 25's list. DELIBERATELY SEPARATE from the S3-F2 employer-context
 * candidate components: this table renders phone/email regardless of the
 * candidate's privacy toggles (the audited S6a-B1 relaxation) — the employer
 * components render OMISSION and must never learn an `isAdmin` prop.
 *
 * Tab semantics: the four ACCOUNT states + All. "Purged" is a tab, not a
 * hidden state — tombstones remain in the list as records (their applications
 * still exist for employers); an empty list after a purge would suggest the
 * applications vanished too. PENDING_DELETION filtering works on the wire
 * status (a purged account also carries that status — the tombstone rendering
 * separates them visually).
 */
const STATUS_TABS = ['ALL', 'ACTIVE', 'SUSPENDED', 'PENDING_DELETION'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export function CandidateTable() {
  const t = useTranslations('admin.candidates');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const statusParam = (searchParams.get('status') ?? 'ALL').toUpperCase();
  const activeTab: StatusTab = (STATUS_TABS as readonly string[]).includes(statusParam)
    ? (statusParam as StatusTab)
    : 'ALL';
  const visibility = searchParams.get('visibility') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [rows, setRows] = useState<AdminCandidateCard[] | null>(null);
  const [meta, setMeta] = useState<CandidateListMeta | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      // NATIVE history (the S6a-F2 lesson): a filter change is pure client
      // state; router.replace fires an RSC fetch that dies under MSW's worker
      // and falls back to a full reload, dropping the in-memory token.
      const qs = next.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const result = await listCandidates({
        status: activeTab === 'ALL' ? undefined : (activeTab as UserStatus),
        visibility: visibility === '' ? undefined : visibility === 'true',
        search: search || undefined,
        page,
      });
      setRows(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err as Error);
    }
  }, [activeTab, visibility, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Dynamic search: debounce the typed draft into the URL, which drives the
  // refetch — no submit button, the list filters live as you type. The
  // `trimmed === search` guard makes this a no-op on mount and once the draft
  // and URL are already in sync, so the debounce's own URL write doesn't loop.
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === search) return;
    const id = setTimeout(() => setParam('search', trimmed || null), 300);
    return () => clearTimeout(id);
  }, [searchDraft, search, setParam]);

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Account-state tabs */}
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

      {/* Visibility + search (name / phone / email — the point of the relaxation) */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          {t('visibilityFilterLabel')}
          <select
            value={visibility}
            onChange={(e) => setParam('visibility', e.target.value || null)}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="">{t('visibilityAll')}</option>
            <option value="true">{t('visibilityVisible')}</option>
            <option value="false">{t('visibilityHidden')}</option>
          </select>
        </label>

        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute start-3 size-4 text-neutral-600"
            aria-hidden="true"
          />
          <label htmlFor="candidate-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="candidate-search"
            type="search"
            role="searchbox"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="min-h-[44px] w-72 rounded-lg border border-neutral-300 ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </div>
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
                  {t('col.candidate')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.phone')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.completion')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.visibility')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.status')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.memberSince')}
                </th>
                <th scope="col" className="p-3">
                  <span className="sr-only">{t('col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const state = accountState(c);
                const purged = state === 'PURGED';
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      'border-b border-neutral-100 last:border-0',
                      purged && 'bg-neutral-50 text-neutral-600',
                    )}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        {/* No photo in the admin payload — an initial avatar, or a
                            void one for the tombstone. */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                            purged
                              ? 'bg-neutral-200 text-neutral-600'
                              : 'bg-primary-50 text-primary-700',
                          )}
                        >
                          {purged ? '—' : c.fullName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <p
                            className={cn(
                              'font-medium',
                              purged ? 'text-neutral-600' : 'text-neutral-900',
                            )}
                          >
                            {c.fullName}
                          </p>
                          <p className="text-xs text-neutral-600">{c.email ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-neutral-600">{c.phone ?? '—'}</td>
                    <td className="p-3 text-neutral-600">{c.completionPct}%</td>
                    <td className="p-3 text-neutral-600">
                      {purged ? '—' : c.profileVisible ? t('visible') : t('hidden')}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <CandidateStatusBadge card={c} />
                        {state === 'PENDING_DELETION' && c.deletionDueAt && (
                          <span className="text-xs text-warning-fg">
                            {t('autoPurgesIn', { days: daysUntil(c.deletionDueAt) })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-neutral-600">{formatDate(c.createdAt, locale)}</td>
                    <td className="p-3 text-end">
                      {/* A tombstone has NO actions — nothing is left to do to it. */}
                      {!purged && (
                        <Link
                          href={`/${locale}/admin/candidates/${c.id}`}
                          aria-label={t('detailAria', { name: c.fullName })}
                          className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                        >
                          {t('detail')}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
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

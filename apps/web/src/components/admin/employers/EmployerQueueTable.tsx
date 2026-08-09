'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  listEmployers,
  type Company,
  type CompanyStatus,
  type CompanyType,
  type EmployerListMeta,
} from '@/lib/api/admin-employers';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format/date';

const STATUS_TABS = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

/**
 * Display order: "All" pinned first, then the statuses A→Z by their VISIBLE
 * label.
 *
 * Sorted at render rather than by reordering the constant above, because the
 * labels are translated — a fixed array would only ever be alphabetical in
 * English and would silently mis-order Hindi and Arabic. `localeCompare` with
 * the active locale is what "alphabetical" actually means on a localised
 * screen, and a status added later slots itself in with no edit here.
 *
 * This is presentation only: STATUS_TABS stays the source of truth for which
 * values are valid, and PENDING remains the default tab regardless of position.
 */
function orderedStatusTabs(locale: string, label: (tab: StatusTab) => string): StatusTab[] {
  const rest = STATUS_TABS.filter((tab) => tab !== 'ALL').sort((a, b) =>
    label(a).localeCompare(label(b), locale),
  );
  return ['ALL', ...rest];
}

const STATUS_BADGE: Record<CompanyStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'neutral',
};

/**
 * The approval queue. Filter state lives in the URL, not component state — the
 * dashboard's "Pending employer reviews" card deep-links to
 * `?status=PENDING`, and a bookmarked/shared filter must reproduce the exact
 * view. PENDING is the default tab because pending reviews are the queue's
 * reason to exist; "show me everything" is the deliberate act, not the landing.
 */
export function EmployerQueueTable() {
  const t = useTranslations('admin.employers');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const statusParam = (searchParams.get('status') ?? 'PENDING').toUpperCase();
  const activeTab: StatusTab = (STATUS_TABS as readonly string[]).includes(statusParam)
    ? (statusParam as StatusTab)
    : 'PENDING';
  const typeFilter = searchParams.get('type') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [rows, setRows] = useState<Company[] | null>(null);
  const [meta, setMeta] = useState<EmployerListMeta | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      // Any filter change resets pagination — page 3 of a different filter is noise.
      if (key !== 'page') next.delete('page');
      // NATIVE history, not router.replace, deliberately: a filter change is
      // pure CLIENT state — no server component needs re-rendering. Next ≥14.1
      // syncs useSearchParams with history.replaceState (official shallow
      // routing), so the table refetches via its own effect. router.replace
      // would fire an RSC payload fetch per click — a wasted round-trip that,
      // under MSW's service worker, also fails outright and falls back to a
      // FULL page reload (dropping the in-memory token → bounced to login).
      const qs = next.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const result = await listEmployers({
        status: activeTab === 'ALL' ? undefined : (activeTab as CompanyStatus),
        type: (typeFilter || undefined) as CompanyType | undefined,
        search: search || undefined,
        page,
      });
      setRows(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(err as Error);
    }
  }, [activeTab, typeFilter, search, page]);

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
      {/* Status tabs */}
      <div role="tablist" aria-label={t('statusFilterLabel')} className="flex flex-wrap gap-1">
        {orderedStatusTabs(locale, (tab) => t(`statusTab.${tab}`)).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            // 'ALL' must be written explicitly (?status=ALL): dropping the param
            // instead collides with the default, which reads absent status as
            // PENDING — so the ALL tab could never activate. `activeTab` maps ALL
            // back to an unfiltered query (status: undefined) at fetch time.
            onClick={() => setParam('status', tab)}
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

      {/* Type + search */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          {t('typeFilterLabel')}
          <select
            value={typeFilter}
            onChange={(e) => setParam('type', e.target.value || null)}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="">{t('typeAll')}</option>
            <option value="LOCAL">{t('typeLocal')}</option>
            <option value="FOREIGN">{t('typeForeign')}</option>
          </select>
        </label>

        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute start-3 size-4 text-neutral-600"
            aria-hidden="true"
          />
          <label htmlFor="employer-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="employer-search"
            type="search"
            role="searchbox"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="min-h-[44px] w-64 rounded-lg border border-neutral-300 ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </div>
      </div>

      {/* The table */}
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
              <tr className="border-b border-neutral-200 text-start">
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.company')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.type')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.registrationNumber')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.submitted')}
                </th>
                <th scope="col" className="p-3 text-start font-semibold text-neutral-700">
                  {t('col.status')}
                </th>
                <th scope="col" className="p-3">
                  <span className="sr-only">{t('col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3 font-medium text-neutral-900">{c.name}</td>
                  <td className="p-3">
                    <Badge variant={c.type === 'FOREIGN' ? 'info' : 'neutral'}>
                      {t(`type.${c.type}`)}
                    </Badge>
                  </td>
                  <td className="p-3 text-neutral-600">{c.registrationNumber ?? '—'}</td>
                  <td className="p-3 text-neutral-600">{formatDate(c.createdAt, locale)}</td>
                  <td className="p-3">
                    <Badge variant={STATUS_BADGE[c.status]}>{t(`status.${c.status}`)}</Badge>
                  </td>
                  <td className="p-3 text-end">
                    <Link
                      href={`/${locale}/admin/employers/${c.id}`}
                      aria-label={t('reviewAria', { name: c.name })}
                      className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    >
                      {t('review')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
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

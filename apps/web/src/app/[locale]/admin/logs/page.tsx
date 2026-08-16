'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { listLogs, type AuditLogEntry, type LogQuery } from '@/lib/api/admin-logs';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import {
  EMPTY_FILTERS,
  LogFilters,
  type LogFilterValues,
} from '@/components/admin/logs/LogFilters';
import { LogTable } from '@/components/admin/logs/LogTable';
import { ExportButton } from '@/components/admin/logs/ExportButton';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as Array<keyof LogFilterValues>;

function filtersFromParams(params: URLSearchParams): LogFilterValues {
  const values = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) values[key] = params.get(key) ?? '';
  return values;
}

function toQuery(filters: LogFilterValues): LogQuery {
  const query: LogQuery = {};
  for (const key of FILTER_KEYS) {
    if (filters[key]) query[key] = filters[key];
  }
  return query;
}

/**
 * Screen 29 — the audit explorer (replaces the S6a-F1 placeholder).
 *
 * Filters live in the URL (an investigation is a link a teammate can open), and
 * URL writes go through NATIVE history — the S6a-F2 lesson: router.replace
 * fires an RSC round-trip per filter click, which is pure waste for client
 * state and, under MSW's service worker, falls back to a full reload that
 * drops the in-memory token.
 *
 * Keyset accumulation: a filter change RESETS the list; "Load more" APPENDS the
 * next cursor page. Rows are deduped by id on append — the API guarantees no
 * duplicates on a stable walk, but a retry after a mid-request filter change
 * must never render the same row twice.
 */
function LogsScreen() {
  const t = useTranslations('admin.logs');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = filtersFromParams(searchParams);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  // A filter change mid-flight must not let the stale response land.
  const requestSeq = useRef(0);

  const filterKey = JSON.stringify(filters);

  const loadFirstPage = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const page = await listLogs(toQuery(JSON.parse(filterKey) as LogFilterValues));
      if (seq !== requestSeq.current) return;
      setEntries(page.data);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err as Error);
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  function setFilters(next: LogFilterValues) {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      if (next[key]) params.set(key, next[key]);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await listLogs({ ...toQuery(filters), cursor: nextCursor });
      setEntries((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id));
        return [...(prev ?? []), ...page.data.filter((e) => !seen.has(e.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // Keep what we have; the button stays for a retry.
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  return (
    <div className={ADMIN_PAGE_SHELL}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
        </div>
        <ExportButton query={toQuery(filters)} approximateCount={entries?.length ?? 0} />
      </div>

      <LogFilters values={filters} onChange={setFilters} />

      <LogTable
        entries={entries}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={nextCursor !== null}
        onLoadMore={() => void loadMore()}
        error={error && !isLoading ? t('loadFailed') : null}
        onRetry={() => void loadFirstPage()}
      />
    </div>
  );
}

export default function AdminLogsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <LogsScreen />
    </Suspense>
  );
}

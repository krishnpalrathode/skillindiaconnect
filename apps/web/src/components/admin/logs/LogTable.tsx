'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { AuditLogEntry } from '@/lib/api/admin-logs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { LogRow } from './LogRow';

/**
 * KEYSET pagination, presented honestly: a "Load more" that APPENDS, and a
 * clear end-of-results line when the cursor runs out. Deliberately NO page
 * numbers — the API walks a cursor over an append-only table; "page 3 of 41"
 * would be an invention (totals shift under concurrent inserts, and jumping to
 * a page is not an operation the API has). Newest-first is stated in the
 * caption so the reading order is never a guess.
 */
export function LogTable({
  entries,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  error,
  onRetry,
}: {
  entries: AuditLogEntry[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  error: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations('admin.logs');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm font-medium text-error-fg">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-sm text-neutral-500">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('tableCaption')}</caption>
          <thead>
            <tr className="border-b border-neutral-200">
              <th scope="col" className="p-2">
                <span className="sr-only">{t('col.expand')}</span>
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.time')}
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.module')}
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.action')}
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.actor')}
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.target')}
              </th>
              <th scope="col" className="p-2 text-start text-xs font-semibold text-neutral-700">
                {t('col.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore && <Spinner size={14} label="" />}
          {t('loadMore')}
        </Button>
      ) : (
        <p role="status" className="py-2 text-center text-xs text-neutral-400">
          {t('endOfResults')}
        </p>
      )}
    </div>
  );
}

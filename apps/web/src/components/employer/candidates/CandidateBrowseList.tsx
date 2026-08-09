'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  browseCandidates,
  type CandidateBrowseCard as CandidateBrowseCardModel,
} from '@/lib/api/employer-candidates';
import type { CandidateBrowseFilters } from '@/lib/employer/candidateFilters';
import { CandidateBrowseCard } from './CandidateBrowseCard';
import { Pagination } from '@/components/ui/pagination';

interface CandidateBrowseListProps {
  filters: CandidateBrowseFilters;
}

const PAGE_SIZE = 12;

type Phase = 'loading' | 'ready' | 'error';

function CardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Candidate browse grid with a numbered pager.
 *
 * Refetches whenever `filters` or the page change (a stale-response guard drops
 * results from a superseded request). Changing a filter resets to page 1 —
 * otherwise a narrower filter can strand the user on a page that no longer
 * exists.
 */
export function CandidateBrowseList({ filters }: CandidateBrowseListProps) {
  const t = useTranslations('employer.candidates');

  const [items, setItems] = useState<CandidateBrowseCardModel[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [phase, setPhase] = useState<Phase>('loading');

  // Monotonic token so a slow response for old filters can't overwrite a newer one.
  const requestSeq = useRef(0);

  // Filters are an object rebuilt each render, so depend on a stable signature
  // rather than the reference — otherwise this resets the page on every render.
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const loadPage = useCallback(() => {
    const seq = ++requestSeq.current;
    setPhase('loading');
    browseCandidates(filters, { page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.data);
        setTotalPages(Math.max(1, res.meta.totalPages));
        setPhase('ready');
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setPhase('error');
      });
  }, [filters, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  if (phase === 'loading') return <CardSkeletons />;

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-neutral-200 bg-white py-16 text-center">
        <p className="text-sm text-neutral-600">{t('loadError')}</p>
        <Button variant="outline" size="sm" onClick={loadPage}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white py-16 px-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
          <Users className="size-6 text-neutral-600" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-neutral-700">{t('empty.title')}</p>
          <p className="mt-1 text-xs text-neutral-600">{t('empty.body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((candidate) => (
          <li key={candidate.id}>
            <CandidateBrowseCard candidate={candidate} />
          </li>
        ))}
      </ul>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

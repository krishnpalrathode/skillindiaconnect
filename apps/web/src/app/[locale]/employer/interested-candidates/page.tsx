'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Star, Send, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';
import {
  listInterested,
  notifyInterested,
  type InterestedCandidate,
} from '@/lib/api/employer-interest';

const PAGE_SIZE = 20;

export default function InterestedCandidatesPage() {
  const t = useTranslations('employer.interest');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [items, setItems] = useState<InterestedCandidate[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ queued: number; skipped: number } | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const res = await listInterested({ page, pageSize: PAGE_SIZE });
      setItems(res.data);
      setTotalPages(Math.max(1, res.meta.totalPages));
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Selection is per-page state; changing page starts a fresh selection rather
  // than silently carrying hidden rows into a send the user cannot see.
  useEffect(() => {
    setSelected(new Set());
    setResult(null);
  }, [page]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Already-contacted rows are never selectable — the server refuses them anyway. */
  const selectableIds = items.filter((c) => c.notifiedAt === null).map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const send = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    setResult(null);
    try {
      const res = await notifyInterested([...selected]);
      setResult(res);
      setSelected(new Set());
      await load(); // refresh notifiedAt badges
    } catch {
      setPhase('error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={EMPLOYER_PAGE_SHELL}>
      {/* Heading sizing matches the sibling employer list pages (My Jobs,
          Candidates) — this page was rendering one step smaller. */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('pageSubtitle')}</p>
      </header>

      {phase === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white py-16 text-center">
          <p className="text-sm text-neutral-600">{t('loadError')}</p>
          <Button variant="outline" size="sm" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      )}

      {phase === 'ready' && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white py-16 px-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
            <Star className="size-6 text-neutral-600" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">{t('emptyTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('emptyBody')}</p>
          </div>
          <Link
            href={`/${locale}/employer/candidates`}
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            {t('browseCandidates')}
          </Link>
        </div>
      )}

      {phase === 'ready' && items.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white/90 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={selectableIds.length === 0}
                onChange={(e) => setSelected(e.target.checked ? new Set(selectableIds) : new Set())}
                className="size-4 rounded border-neutral-300"
              />
              {t('selectAll')}
            </label>

            <div className="flex items-center gap-3">
              {result && (
                <span role="status" className="text-xs text-neutral-600">
                  {t('notifyResult', { queued: result.queued, skipped: result.skipped })}
                </span>
              )}
              <Button size="sm" onClick={send} disabled={selected.size === 0 || sending}>
                <Send className="size-4" aria-hidden="true" />
                {t('notifySelected', { count: selected.size })}
              </Button>
            </div>
          </div>

          {/* The cost of the action is stated where the action is, not buried in
              a tooltip — each send is a real message to a worker's phone. */}
          <p className="text-xs text-neutral-600">{t('notifyCostHint')}</p>

          <ul className="flex flex-col gap-3">
            {items.map((c) => {
              const contacted = c.notifiedAt !== null;
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    disabled={contacted}
                    onChange={() => toggle(c.id)}
                    aria-label={t('selectCandidate', { name: c.fullName })}
                    className="size-4 shrink-0 rounded border-neutral-300"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${locale}/employer/candidates/${c.id}`}
                      className="truncate text-sm font-medium text-neutral-900 hover:text-primary-700"
                    >
                      {c.fullName}
                    </Link>
                    <p className="truncate text-xs text-neutral-600">
                      {c.currentLocation ?? t('locationUnknown')}
                    </p>
                  </div>

                  {contacted && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success-fg">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      {t('contacted')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

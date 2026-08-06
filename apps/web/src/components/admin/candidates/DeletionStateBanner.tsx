'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { formatDate as fmtDate } from '@/lib/format/date';
import { Clock, Archive } from 'lucide-react';
import type { AdminCandidateCard } from '@/lib/api/admin-candidates';

function formatDate(iso: string): string {
  return fmtDate(iso);
}

/** Whole days until the ISO date, floored at 0 — display only, never computed into data. */
export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/**
 * The deletion-state facts, stated plainly:
 * - PENDING_DELETION: the candidate asked to leave; the clock is running.
 * - PURGED: the erasure happened and is permanent. No undo is offered anywhere
 *   because none exists — the banner SAYS so instead.
 * Renders nothing for ordinary accounts.
 */
export function DeletionStateBanner({
  card,
}: {
  card: Pick<AdminCandidateCard, 'status' | 'deletionDueAt' | 'purgedAt'>;
}) {
  const t = useTranslations('admin.candidates.deletionState');

  if (card.purgedAt) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl bg-neutral-100 p-4">
        <Archive className="mt-0.5 size-5 shrink-0 text-neutral-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-neutral-800">
            {t('purgedTitle', { date: formatDate(card.purgedAt) })}
          </p>
          <p className="mt-1 text-sm text-neutral-600">{t('purgedBody')}</p>
        </div>
      </div>
    );
  }

  if (card.status === 'PENDING_DELETION' && card.deletionDueAt) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl bg-warning-bg p-4">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-warning-fg">
            {t('pendingTitle', { days: daysUntil(card.deletionDueAt) })}
          </p>
          <p className="mt-1 text-sm text-warning-fg/90">
            {t('pendingBody', { date: formatDate(card.deletionDueAt) })}
          </p>
        </div>
      </div>
    );
  }

  return null;
}

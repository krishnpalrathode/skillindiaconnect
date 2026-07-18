'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase } from 'lucide-react';
import { listAdminJobs } from '@/lib/api/admin-jobs';
import { cn } from '@/lib/utils';

/**
 * "N jobs awaiting review" — the console's second action queue (after employer
 * approvals). The dashboard's queue card deep-links to ?status=PENDING_REVIEW;
 * this banner is the same fact ON the screen, so an admin who arrived some
 * other way still sees the work waiting. Clicking it applies the same filter.
 *
 * Zero is stated plainly, not hidden — an empty queue is information.
 */
export function ReviewQueueBanner({
  activeFilter,
  onShowQueue,
}: {
  /** True when the list is already filtered to PENDING_REVIEW. */
  activeFilter: boolean;
  onShowQueue: () => void;
}) {
  const t = useTranslations('admin.jobs.queue');
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // meta.total of a pageSize-1 query IS the queue depth — no extra endpoint.
    listAdminJobs({ status: 'PENDING_REVIEW', pageSize: 1 })
      .then((page) => setCount(page.meta.total))
      .catch(() => setCount(null));
  }, []);

  if (count === null) return null;

  const waiting = count > 0;
  return (
    <button
      type="button"
      onClick={onShowQueue}
      disabled={activeFilter && waiting}
      aria-label={waiting ? t('waitingAria', { count }) : t('emptyAria')}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 rounded-xl border p-4 text-start transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        waiting
          ? 'border-warning-fg/40 bg-warning-bg hover:border-warning-fg/60'
          : 'border-neutral-200 bg-white',
        activeFilter && waiting && 'cursor-default',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          waiting ? 'bg-warning-fg/10 text-warning-fg' : 'bg-neutral-100 text-neutral-500',
        )}
      >
        <Briefcase className="size-5" />
      </span>
      <span className="flex-1">
        <span
          className={cn(
            'block text-sm font-semibold',
            waiting ? 'text-warning-fg' : 'text-neutral-600',
          )}
        >
          {waiting ? t('waiting', { count }) : t('empty')}
        </span>
        {waiting && !activeFilter && (
          <span className="block text-xs text-neutral-600">{t('showQueue')}</span>
        )}
      </span>
    </button>
  );
}

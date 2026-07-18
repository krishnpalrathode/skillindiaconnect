'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Briefcase, ChevronRight } from 'lucide-react';
import type { AdminDashboard } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * The two work queues — the reason the console exists.
 *
 * An admin does not open this tool to admire counts; they open it because
 * something is waiting for a decision. So the queues are the first thing on the
 * page and the largest thing on it, not a statistic in a row of statistics.
 *
 * Each card is a LINK carrying the filter that makes it true — clicking "4
 * pending employer reviews" lands you on exactly those four, not on an unfiltered
 * list you then have to narrow yourself. The count and the destination cannot
 * disagree, because the count IS the destination's filter.
 *
 * A queue at zero is stated plainly ("nothing waiting"), not hidden — an empty
 * queue is information, and a card that vanishes at zero makes you wonder whether
 * it broke.
 */
function QueueCard({
  href,
  icon: Icon,
  label,
  count,
  emptyLabel,
}: {
  href: string;
  icon: typeof Building2;
  label: string;
  count: number;
  emptyLabel: string;
}) {
  const waiting = count > 0;

  return (
    <Link
      href={href}
      // The accessible name carries the COUNT and its meaning — a screen-reader
      // user must not have to infer "4" from a number floating next to an icon.
      aria-label={waiting ? `${label}: ${count}` : `${label}: ${emptyLabel}`}
      className={cn(
        'group flex min-h-[44px] items-center gap-4 rounded-xl border p-5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        waiting
          ? 'border-warning-fg/30 bg-warning-bg hover:border-warning-fg/60'
          : 'border-neutral-200 bg-white hover:border-neutral-300',
      )}
    >
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-lg',
          waiting ? 'bg-warning-fg/10 text-warning-fg' : 'bg-neutral-100 text-neutral-500',
        )}
        aria-hidden="true"
      >
        <Icon className="size-6" />
      </span>

      <span className="flex-1">
        <span className="block text-sm font-medium text-neutral-600">{label}</span>
        <span
          aria-hidden="true"
          className={cn(
            'block text-3xl font-bold tabular-nums',
            waiting ? 'text-warning-fg' : 'text-neutral-400',
          )}
        >
          {count}
        </span>
        {!waiting && (
          <span aria-hidden="true" className="block text-xs text-neutral-500">
            {emptyLabel}
          </span>
        )}
      </span>

      <ChevronRight
        className="size-5 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

export function QueueCards({ data }: { data: AdminDashboard }) {
  const t = useTranslations('admin.dashboard');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  return (
    <section aria-labelledby="admin-queues-heading" className="flex flex-col gap-3">
      <h2 id="admin-queues-heading" className="text-sm font-semibold text-neutral-700">
        {t('queuesHeading')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <QueueCard
          href={`/${locale}/admin/employers?status=PENDING`}
          icon={Building2}
          label={t('pendingEmployerReviews')}
          count={data.pendingEmployerReviews}
          emptyLabel={t('queueEmpty')}
        />
        <QueueCard
          href={`/${locale}/admin/jobs?status=PENDING_REVIEW`}
          icon={Briefcase}
          label={t('pendingJobReviews')}
          count={data.pendingJobReviews}
          emptyLabel={t('queueEmpty')}
        />
      </div>
    </section>
  );
}

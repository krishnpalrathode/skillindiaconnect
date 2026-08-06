'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format/date';
import type { components } from '@skillindiaconnect/shared-types';

type JobCard = components['schemas']['JobCard'];

interface RecentJobsTableProps {
  jobs: JobCard[];
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('employer.dashboard.recentJobs');
  const configs: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: t('statusActive'), className: 'bg-success-bg text-success-fg' },
    DRAFT: { label: t('statusDraft'), className: 'bg-neutral-100 text-neutral-600' },
    PAUSED: { label: t('statusPaused'), className: 'bg-warning-bg text-warning-fg' },
    ARCHIVED: { label: t('statusArchived'), className: 'bg-neutral-100 text-neutral-600' },
  };
  const cfg = configs[status] ?? { label: status, className: 'bg-neutral-100 text-neutral-600' };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}

export function RecentJobsTable({ jobs }: RecentJobsTableProps) {
  const t = useTranslations('employer.dashboard.recentJobs');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  return (
    <section
      aria-labelledby="recent-jobs-heading"
      className="h-full overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/90 shadow-sm backdrop-blur-sm"
    >
      <div className="px-5 sm:px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
        <h2
          id="recent-jobs-heading"
          className="flex items-center gap-2.5 text-base font-semibold text-neutral-900"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
            <Briefcase className="size-4" aria-hidden="true" />
          </span>
          {t('title')}
        </h2>
        {jobs.length > 0 && (
          <Link
            href={`/${locale}/employer/jobs`}
            className="rounded text-sm font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            View all
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 px-4 text-center">
          <span
            className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#EEF3FB] to-[#E8F0FE] text-[#0F3D91] ring-8 ring-[#F5F8FC]"
            aria-hidden="true"
          >
            <Briefcase className="size-7" />
          </span>
          <div>
            <p className="text-base font-semibold text-neutral-900">{t('emptyTitle')}</p>
            <p className="mt-1 text-sm text-neutral-600">{t('emptyBody')}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th
                  scope="col"
                  className="text-start px-4 sm:px-6 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide"
                >
                  {t('columnTitle')}
                </th>
                <th
                  scope="col"
                  className="text-start px-4 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide"
                >
                  {t('columnStatus')}
                </th>
                <th
                  scope="col"
                  className="text-start px-4 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide hidden sm:table-cell"
                >
                  {t('columnPosted')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {jobs.map((job) => (
                <tr key={job.id} className="transition-colors hover:bg-neutral-50/70">
                  <td className="px-4 sm:px-6 py-3.5 font-medium text-neutral-900">
                    <Link
                      href={`/${locale}/employer/jobs/${job.id}`}
                      className="rounded transition-colors hover:text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    >
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status="ACTIVE" />
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600 hidden sm:table-cell">
                    {job.createdAt ? formatDate(job.createdAt, locale) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

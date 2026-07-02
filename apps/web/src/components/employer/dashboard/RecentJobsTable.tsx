'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    ARCHIVED: { label: t('statusArchived'), className: 'bg-neutral-100 text-neutral-400' },
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
      className="bg-white rounded-xl border border-neutral-200 overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
        <h2 id="recent-jobs-heading" className="text-base font-semibold text-neutral-900">
          {t('title')}
        </h2>
        {jobs.length > 0 && (
          <Link
            href={`/${locale}/employer/jobs`}
            className="text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            View all
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
          <span className="size-12 rounded-full bg-neutral-100 flex items-center justify-center">
            <Briefcase className="size-6 text-neutral-400" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">{t('emptyTitle')}</p>
            <p className="text-xs text-neutral-500 mt-1">{t('emptyBody')}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th
                  scope="col"
                  className="text-start px-4 sm:px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                >
                  {t('columnTitle')}
                </th>
                <th
                  scope="col"
                  className="text-start px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                >
                  {t('columnStatus')}
                </th>
                <th
                  scope="col"
                  className="text-start px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide hidden sm:table-cell"
                >
                  {t('columnPosted')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 sm:px-6 py-3 font-medium text-neutral-900">
                    <Link
                      href={`/${locale}/employer/jobs/${job.id}`}
                      className="hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
                    >
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status="ACTIVE" />
                  </td>
                  <td className="px-4 py-3 text-neutral-500 hidden sm:table-cell">
                    {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : '—'}
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

'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MapPin, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BenefitChips } from '@/components/jobs/BenefitChips';
import { SaveJobButton } from '@/components/jobs/SaveJobButton';
import { Ltr } from '@/components/common/Ltr';
import { formatPostedAgo, formatSalaryRange, isNewJob } from '@/lib/jobs/format';
import type { components } from '@skillindiaconnect/shared-types';

type JobCardType = components['schemas']['JobCard'];

interface RecommendedJobCardProps {
  job: JobCardType;
  locale: string;
}

/**
 * Dashboard-only presentation of a recommended job. Intentionally separate from
 * the shared `components/jobs/JobCard` (used by the jobs list + detail pages) so
 * this restyle stays scoped to the dashboard, while reusing the exact same
 * building blocks — SaveJobButton, BenefitChips, and the salary/date formatters —
 * so all behaviour (saving, benefit relabelling by market, i18n) is unchanged.
 */
export function RecommendedJobCard({ job, locale }: RecommendedJobCardProps) {
  const t = useTranslations('jobs.card');
  const href = `/${locale}/jobs/${job.id}`;
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);

  return (
    <div className="group rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0F3D91]/20 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
            {t(job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
          </Badge>
          {isNewJob(job.createdAt) && <Badge variant="success">{t('newBadge')}</Badge>}
        </div>
        <SaveJobButton jobId={job.id} initialSaved={job.isSaved ?? null} variant="icon" />
      </div>

      <div className="mt-2">
        <h3 className="text-lg font-bold leading-snug text-neutral-900">
          <Link
            href={href}
            className="rounded transition-colors hover:text-[#0F3D91] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {job.title}
          </Link>
        </h3>
        <p className="text-sm text-neutral-600">{job.companyName}</p>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-600">
        <MapPin className="size-4 shrink-0" aria-hidden="true" />
        {job.location}
      </p>

      {/* RTL-001: bidi-isolated so the range bounds cannot swap in Arabic. */}
      {salary && (
        <p className="mt-2 text-base font-bold text-neutral-900">
          <Ltr>{salary}</Ltr>
        </p>
      )}

      <BenefitChips job={job} className="mt-3" />

      <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4">
        <p className="text-xs text-neutral-600">{formatPostedAgo(job.createdAt, locale)}</p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-[#0F3D91] transition-all hover:gap-1.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('viewDetails')}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

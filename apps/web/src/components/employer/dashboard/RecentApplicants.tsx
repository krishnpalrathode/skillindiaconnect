'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Users } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { APPLICANT_STATUS_VARIANT } from '@/components/employer/applicants/ApplicantCard';

type ApplicantSummary = components['schemas']['ApplicantSummary'];

interface RecentApplicantsProps {
  applicants: ApplicantSummary[];
}

/**
 * Live recent applicants (S4-F3 swap — the S2 empty-state placeholder retires).
 * Each row links into the relevant job's applicant pipeline (Screen 18).
 */
export function RecentApplicants({ applicants }: RecentApplicantsProps) {
  const t = useTranslations('employer.dashboard.recentApplicants');
  const tA = useTranslations('applicants');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  return (
    <section
      aria-labelledby="recent-applicants-heading"
      className="h-full overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/90 shadow-sm backdrop-blur-sm"
    >
      <div className="px-5 sm:px-6 py-4 border-b border-neutral-100">
        <h2
          id="recent-applicants-heading"
          className="flex items-center gap-2.5 text-base font-semibold text-neutral-900"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
            <Users className="size-4" aria-hidden="true" />
          </span>
          {t('title')}
        </h2>
      </div>

      {applicants.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 px-4 text-center">
          <span
            className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-accent-50 to-accent-100 text-accent-600 ring-8 ring-[#F5F8FC]"
            aria-hidden="true"
          >
            <Users className="size-7" />
          </span>
          <div>
            <p className="text-base font-semibold text-neutral-900">{t('emptyTitle')}</p>
            <p className="mt-1 text-sm text-neutral-600">{t('emptyBody')}</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {applicants.map((a) => (
            <li key={a.applicationId}>
              <Link
                href={`/${locale}/employer/jobs/${a.jobId}/applicants`}
                className="flex items-center gap-3 px-5 sm:px-6 py-3.5 transition-colors hover:bg-neutral-50/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <span className="size-10 shrink-0 rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-white flex items-center justify-center text-sm font-semibold">
                  {a.candidateName
                    ? a.candidateName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()
                    : '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 truncate">{a.candidateName}</p>
                  <p className="text-xs text-neutral-600 truncate">{a.jobTitle}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-600">
                  {tA('matchShort', { score: a.matchScore })}
                </span>
                <Badge variant={APPLICANT_STATUS_VARIANT[a.status]}>
                  {tA(`status.${a.status}`)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

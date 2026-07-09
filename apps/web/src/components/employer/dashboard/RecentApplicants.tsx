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
      className="bg-white rounded-xl border border-neutral-200 overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-4 border-b border-neutral-100">
        <h2 id="recent-applicants-heading" className="text-base font-semibold text-neutral-900">
          {t('title')}
        </h2>
      </div>

      {applicants.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
          <span className="size-12 rounded-full bg-neutral-100 flex items-center justify-center">
            <Users className="size-6 text-neutral-400" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-neutral-700">{t('emptyTitle')}</p>
            <p className="text-xs text-neutral-500 mt-1">{t('emptyBody')}</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {applicants.map((a) => (
            <li key={a.applicationId}>
              <Link
                href={`/${locale}/employer/jobs/${a.jobId}/applicants`}
                className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <span className="size-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold shrink-0">
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
                  <p className="text-xs text-neutral-500 truncate">{a.jobTitle}</p>
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

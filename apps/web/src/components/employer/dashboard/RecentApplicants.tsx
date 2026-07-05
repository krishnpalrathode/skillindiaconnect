'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type CandidateProfile = components['schemas']['CandidateProfile'];

interface RecentApplicantsProps {
  applicants: CandidateProfile[];
}

/**
 * Recent applicants panel. At S2, applications (S4) don't exist so this
 * always renders the empty state — honest placeholder, no fabricated data.
 */
export function RecentApplicants({ applicants }: RecentApplicantsProps) {
  const t = useTranslations('employer.dashboard.recentApplicants');

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
          {applicants.map((applicant) => (
            <li key={applicant.id} className="flex items-center gap-3 px-4 sm:px-6 py-3">
              <span className="size-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold shrink-0">
                {applicant.fullName
                  ? applicant.fullName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()
                  : '?'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 truncate">
                  {applicant.fullName ?? applicant.email}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

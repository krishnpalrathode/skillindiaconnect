'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { CompletionRing } from '@/components/common/CompletionRing';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];

interface ProfileSummaryCardProps {
  profile: CandidateProfile;
  completion: CompletionResult;
}

export function ProfileSummaryCard({ profile, completion }: ProfileSummaryCardProps) {
  const t = useTranslations('dashboard');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const initials = (profile.fullName ?? profile.email)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 flex flex-col items-center gap-4">
      <div
        className="size-14 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold select-none"
        aria-hidden="true"
      >
        {initials}
      </div>

      <div className="text-center">
        <p className="font-semibold text-neutral-900 truncate max-w-[160px]">
          {profile.fullName ?? profile.email}
        </p>
        {profile.isAvailable && (
          <span className="inline-block mt-1 text-xs font-medium text-success-fg bg-success-bg rounded-full px-2 py-0.5">
            Available
          </span>
        )}
      </div>

      <CompletionRing pct={completion.pct} size={80} strokeWidth={8} />

      <p className="text-sm text-neutral-500 text-center">
        {t('profileSummary.completion', { pct: completion.pct })}
      </p>

      {completion.pct < 100 && (
        <Link
          href={`/${locale}/profile`}
          className="text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline"
        >
          {t('profileSummary.completeNow')}
        </Link>
      )}
    </div>
  );
}

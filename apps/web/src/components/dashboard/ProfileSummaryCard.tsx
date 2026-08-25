'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { CompletionRing } from '@/components/common/CompletionRing';
import { Avatar } from '@/components/ui/avatar';
import { candidateDisplayName } from '@/lib/format/display-name';

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

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white shadow-sm">
      {/* Gradient banner */}
      <div className="h-20 bg-gradient-to-br from-[#0F3D91] to-[#2E67B1]" aria-hidden="true" />

      <div className="-mt-11 flex flex-col items-center gap-4 px-5 pb-6">
        {/* Avatar overlapping the banner */}
        <div className="rounded-full bg-white p-1 shadow-md">
          <Avatar
            name={candidateDisplayName(profile)}
            photoUrl={profile.photoUrl}
            className="size-20 text-xl"
          />
        </div>

        <div className="text-center">
          <p className="max-w-[180px] truncate font-semibold text-neutral-900">
            {candidateDisplayName(profile)}
          </p>
          {profile.isAvailable && (
            <span className="mt-1 inline-block rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success-fg">
              Available
            </span>
          )}
        </div>

        <CompletionRing pct={completion.pct} size={144} strokeWidth={12} gradient />

        <p className="text-center text-sm text-neutral-600">
          {t('profileSummary.completion', { pct: completion.pct })}
        </p>

        {completion.pct < 100 && (
          <Link
            href={`/${locale}/profile`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#0F3D91]/25 bg-white px-5 text-sm font-semibold text-[#0F3D91] shadow-sm transition-all hover:bg-[#0F3D91] hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('profileSummary.completeNow')}
          </Link>
        )}
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';

type CandidateProfile = components['schemas']['CandidateProfile'];

interface ProfileStatsProps {
  profile: CandidateProfile;
  className?: string;
}

function StatItem({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 px-2">
      <span className="text-2xl font-bold tabular-nums text-neutral-900">{value}</span>
      <span className="text-center text-xs font-medium leading-tight text-neutral-600">
        {label}
      </span>
    </div>
  );
}

/**
 * Read-only stat chips row.
 * Applications / Shortlisted are S4 placeholders (sourced from Applications module).
 * Years experience is derived from the profile's experiences array.
 * Skills count is live.
 */
export function ProfileStats({ profile, className }: ProfileStatsProps) {
  const t = useTranslations('profile.stats');

  const totalMonths = (profile.experiences ?? []).reduce(
    (acc, e) => acc + (e.years ?? 0) * 12 + (e.months ?? 0),
    0,
  );
  const yearsExp = totalMonths > 0 ? (totalMonths / 12).toFixed(1) : '0';
  const skillsCount = profile.skills?.length ?? 0;

  return (
    <div
      className={cn(
        'rounded-[18px] border border-neutral-200/70 bg-white shadow-sm',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        'flex items-center justify-around divide-x divide-neutral-100 px-2 py-5',
        className,
      )}
    >
      <StatItem value={yearsExp} label={t('yearsExperience')} />
      <StatItem value={skillsCount} label={t('skills')} />
      {/* S4 placeholders — no application data in S1 */}
      <StatItem value={0} label={t('applications')} />
      <StatItem value={0} label={t('shortlisted')} />
    </div>
  );
}

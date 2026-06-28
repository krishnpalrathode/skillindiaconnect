'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { ExperienceList } from '@/components/onboarding/ExperienceList';

type CandidateProfile = components['schemas']['CandidateProfile'];
type WorkExperience = components['schemas']['WorkExperience'];

interface ExperienceStepProps {
  profile: CandidateProfile;
  onProfileUpdate: (updated: CandidateProfile) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 2 — Work Experience.
 * No required fields to advance (soft-block only).
 * Experience entries are saved immediately via API (no draft state).
 */
export function ExperienceStep({ profile, onProfileUpdate, onNext, onBack }: ExperienceStepProps) {
  const t = useTranslations('onboarding.experience');
  const tNav = useTranslations('onboarding.nav');

  const handleExperiencesChange = (exps: WorkExperience[]) => {
    onProfileUpdate({ ...profile, experiences: exps });
  };

  const hasExperience = (profile.experiences?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      <ExperienceList
        experiences={profile.experiences ?? []}
        onExperiencesChange={handleExperiencesChange}
      />

      {/* Soft-block nudge — non-blocking */}
      {!hasExperience && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-info-bg border border-info-fg/20">
          <Info className="size-4 text-info-fg shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-info-fg">{t('softBlock')}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" size="md" onClick={onBack}>
          {tNav('back')}
        </Button>
        <Button type="button" variant="primary" size="md" onClick={onNext}>
          {tNav('next')}
        </Button>
      </div>
    </div>
  );
}

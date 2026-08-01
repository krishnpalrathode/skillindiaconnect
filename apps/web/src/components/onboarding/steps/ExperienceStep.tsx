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
    <div className="flex flex-col gap-7">
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
          {t('title')}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      <ExperienceList
        experiences={profile.experiences ?? []}
        onExperiencesChange={handleExperiencesChange}
      />

      {/* Soft-block nudge — non-blocking */}
      {!hasExperience && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-info-fg/20 bg-info-bg p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <Info className="size-4 text-info-fg" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-info-fg">{t('softBlock')}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBack}
          className="rounded-xl px-6"
        >
          {tNav('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onNext}
          className="rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] px-8 shadow-md transition-all hover:shadow-lg"
        >
          {tNav('next')}
        </Button>
      </div>
    </div>
  );
}

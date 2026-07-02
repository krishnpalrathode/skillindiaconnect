'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { Stepper } from '@/components/onboarding/Stepper';
import type { StepIndex } from '@/components/onboarding/Stepper';
import { PersonalInfoStep } from '@/components/onboarding/steps/PersonalInfoStep';
import { ExperienceStep } from '@/components/onboarding/steps/ExperienceStep';
import { DocumentsSkillsStep } from '@/components/onboarding/steps/DocumentsSkillsStep';
import { PreviewExportStep } from '@/components/onboarding/steps/PreviewExportStep';
import { Spinner } from '@/components/ui/spinner';
import { getCandidateProfile } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';

type CandidateProfile = components['schemas']['CandidateProfile'];

const STEP_KEY = 'sic_onboarding_step';

function readStoredStep(): StepIndex {
  try {
    const raw = sessionStorage.getItem(STEP_KEY);
    const n = Number(raw);
    if (n >= 1 && n <= 4) return n as StepIndex;
  } catch {
    // sessionStorage unavailable (private browsing or SSR guard)
  }
  return 1;
}

function writeStoredStep(step: StepIndex) {
  try {
    sessionStorage.setItem(STEP_KEY, String(step));
  } catch {
    // sessionStorage unavailable — step just won't persist
  }
}

/**
 * Candidate onboarding stepper controller.
 * Resumable: last-visited step is persisted in sessionStorage.
 * Profile is fetched once on mount; each step patches /candidates/me and
 * updates local state without a full re-fetch.
 */
export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const { user } = useAuth();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [step, setStep] = useState<StepIndex>(1);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      router.replace(`/${locale}/login`);
      return;
    }
    if (user.role !== 'CANDIDATE') {
      router.replace(`/${locale}/onboarding/employer`);
      return;
    }

    getCandidateProfile()
      .then((p) => {
        setProfile(p);
        setStep(readStoredStep());
      })
      .catch(() => setFetchError('Failed to load profile. Please refresh.'))
      .finally(() => setLoading(false));
  }, [user, locale, router]);

  const goTo = (next: StepIndex) => {
    setStep(next);
    writeStoredStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={32} label={t('loading')} />
      </div>
    );
  }

  if (fetchError || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-neutral-600">{fetchError ?? 'Profile not found.'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page title + step counter */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 text-center">{t('pageTitle')}</h1>
        <p className="text-sm text-neutral-500 text-center mt-1">
          {t('stepOf', { current: step, total: 4 })}
        </p>
      </div>

      {/* Progress indicator */}
      <Stepper current={step} />

      {/* Step content */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6">
        {step === 1 && (
          <PersonalInfoStep profile={profile} onProfileUpdate={setProfile} onNext={() => goTo(2)} />
        )}
        {step === 2 && (
          <ExperienceStep
            profile={profile}
            onProfileUpdate={setProfile}
            onNext={() => goTo(3)}
            onBack={() => goTo(1)}
          />
        )}
        {step === 3 && (
          <DocumentsSkillsStep
            profile={profile}
            onProfileUpdate={setProfile}
            onNext={() => goTo(4)}
            onBack={() => goTo(2)}
          />
        )}
        {step === 4 && <PreviewExportStep profile={profile} onBack={() => goTo(3)} />}
      </div>
    </div>
  );
}

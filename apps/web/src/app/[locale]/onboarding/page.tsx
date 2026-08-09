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
import { BrandLoader } from '@/components/ui/brand-loader';
import { getCandidateProfile } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';

type CandidateProfile = components['schemas']['CandidateProfile'];

function stepKey(userId: string) {
  return `sic_onboarding_step_${userId}`;
}

function readStoredStep(userId: string): StepIndex {
  try {
    const raw = sessionStorage.getItem(stepKey(userId));
    const n = Number(raw);
    if (n >= 1 && n <= 4) return n as StepIndex;
  } catch {
    // sessionStorage unavailable (private browsing or SSR guard)
  }
  return 1;
}

function writeStoredStep(userId: string, step: StepIndex) {
  try {
    sessionStorage.setItem(stepKey(userId), String(step));
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
  const { user, isLoggingOut } = useAuth();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [step, setStep] = useState<StepIndex>(1);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    // A deliberate sign-out owns its own redirect — see (app)/layout.tsx.
    if (isLoggingOut) return;
    if (!user) {
      router.replace(`/${locale}/login`);
      return;
    }
    if (user.role !== 'CANDIDATE') {
      router.replace(`/${locale}/employer/onboarding`);
      return;
    }

    getCandidateProfile()
      .then((p) => {
        setProfile(p);
        setStep(readStoredStep(user.id));
      })
      .catch(() => setFetchError('Failed to load profile. Please refresh.'))
      .finally(() => setLoading(false));
  }, [user, isLoggingOut, locale, router]);

  const goTo = (next: StepIndex) => {
    setStep(next);
    if (user) writeStoredStep(user.id, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <BrandLoader size="lg" label={t('loading')} />
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
    <div className="flex flex-col gap-7">
      {/* Page title + step counter */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          {t('pageTitle')}
        </h1>
        <p className="mt-2 inline-flex items-center rounded-full bg-[#E8F0FE] px-3.5 py-1 text-sm font-semibold text-[#0F3D91]">
          {t('stepOf', { current: step, total: 4 })}
        </p>
      </div>

      {/* Progress indicator — capped so the connector lines between steps do
          not stretch across the full shell on a wide screen. */}
      <Stepper current={step} className="mx-auto w-full max-w-3xl" />

      {/* Step content */}
      <div className="rounded-[24px] border border-neutral-200/70 bg-white/95 p-6 shadow-[0_8px_30px_rgb(15,61,145,0.06)] backdrop-blur-sm sm:p-8 lg:p-10">
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

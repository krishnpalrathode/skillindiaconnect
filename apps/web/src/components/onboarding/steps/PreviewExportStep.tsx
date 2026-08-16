'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Video } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { ResumeExportHub } from '@/components/resume/ResumeExportHub';
import { postCompleteOnboarding } from '@/lib/api/candidate';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';

type CandidateProfile = components['schemas']['CandidateProfile'];

interface PreviewExportStepProps {
  profile: CandidateProfile;
  onBack: () => void;
}

/**
 * Step 4 — Preview & Export.
 * The functional export hub (S7-F1: completion ring + live preview + Download
 * PDF's async generate→poll→download UX) is `ResumeExportHub`; this step wraps
 * it with the onboarding stepper's navigation.
 *
 * Generating a resume is OPTIONAL and non-blocking: "Save & Continue" →
 * POST /candidates/me/complete-onboarding → /dashboard, whether or not a resume
 * was generated. Video slot = "Coming Soon" (B6).
 */
export function PreviewExportStep({ profile, onBack }: PreviewExportStepProps) {
  const t = useTranslations('onboarding.preview');
  const tNav = useTranslations('onboarding.nav');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async () => {
    setError(null);
    setFinishing(true);
    try {
      await postCompleteOnboarding();
      router.replace(`/${locale}/dashboard`);
    } catch {
      setError('Something went wrong. Please try again.');
      setFinishing(false);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
          {t('title')}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      {/* S7-F1 export hub: completion ring + live preview + Download PDF (async). */}
      <ResumeExportHub profile={profile} />

      {/* Video slot (Coming Soon — B6) */}
      <div className="flex items-start gap-3 rounded-[22px] border-2 border-dashed border-neutral-200 bg-neutral-50/60 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
          <Video className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-700">{t('videoTitle')}</p>
          <p className="mt-0.5 text-xs text-neutral-600">{t('videoComingSoon')}</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
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
          variant="brand"
          size="lg"
          loading={finishing}
          onClick={handleFinish}
          className="rounded-xl px-8 shadow-md transition-all hover:shadow-lg"
        >
          {t('saveAndContinue')}
        </Button>
      </div>
    </div>
  );
}

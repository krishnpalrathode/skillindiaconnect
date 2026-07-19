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
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      {/* S7-F1 export hub: completion ring + live preview + Download PDF (async). */}
      <ResumeExportHub profile={profile} />

      {/* Video slot (Coming Soon — B6) */}
      <div className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-2">
          <Video className="size-4 text-neutral-600" aria-hidden="true" />
          <p className="text-sm font-medium text-neutral-600">{t('videoTitle')}</p>
        </div>
        <p className="text-xs text-neutral-600">{t('videoComingSoon')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" size="md" onClick={onBack}>
          {tNav('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="lg"
          loading={finishing}
          onClick={handleFinish}
        >
          {t('saveAndContinue')}
        </Button>
      </div>
    </div>
  );
}

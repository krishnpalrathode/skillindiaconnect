'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, MessageCircle, Mail, Video, Lock } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { CompletionRing } from '@/components/common/CompletionRing';
import { getCandidateCompletion, postCompleteOnboarding } from '@/lib/api/candidate';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];

interface PreviewExportStepProps {
  profile: CandidateProfile;
  onBack: () => void;
}

/**
 * Step 4 — Preview & Export (shell).
 * CompletionRing reads from GET /candidates/me/completion (server-computed, never client-side).
 * Export actions (Download PDF, Send WhatsApp, Send Email) are S7 — rendered disabled.
 * Video slot = "Coming Soon" (disabled, B6).
 * "Save & Continue" → POST /candidates/me/complete-onboarding → redirects to dashboard.
 */
export function PreviewExportStep({ profile, onBack }: PreviewExportStepProps) {
  const t = useTranslations('onboarding.preview');
  const tNav = useTranslations('onboarding.nav');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always read completion from the server — never compute client-side
  useEffect(() => {
    getCandidateCompletion()
      .then(setCompletion)
      .catch(() => null);
  }, []);

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
        <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      {/* Completion ring (server-computed) */}
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm font-medium text-neutral-700">{t('completionTitle')}</p>
        <CompletionRing
          pct={completion?.pct ?? profile.completionPct ?? 0}
          size={140}
          strokeWidth={12}
        />
        {completion?.sections && (
          <div className="w-full max-w-xs flex flex-col gap-2 mt-2">
            {completion.sections.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <div
                  className={[
                    'w-2 h-2 rounded-full shrink-0',
                    s.complete ? 'bg-success-fg' : 'bg-neutral-300',
                  ].join(' ')}
                  aria-hidden="true"
                />
                <span className="text-xs text-neutral-600 flex-1">{s.label}</span>
                <span className="text-xs font-medium text-neutral-800">{s.pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export actions (S7 — disabled in S1) */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-neutral-700">{t('exportTitle')}</p>
        <p className="text-xs text-neutral-400 flex items-center gap-1">
          <Lock className="size-3" aria-hidden="true" />
          {t('exportComingSoon')}
        </p>

        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="md" disabled aria-label={t('downloadPdf')}>
            <Download className="size-4 text-neutral-400" aria-hidden="true" />
            {t('downloadPdf')}
          </Button>
          <Button type="button" variant="outline" size="md" disabled aria-label={t('sendWhatsapp')}>
            <MessageCircle className="size-4 text-neutral-400" aria-hidden="true" />
            {t('sendWhatsapp')}
          </Button>
          <Button type="button" variant="outline" size="md" disabled aria-label={t('sendEmail')}>
            <Mail className="size-4 text-neutral-400" aria-hidden="true" />
            {t('sendEmail')}
          </Button>
        </div>
      </div>

      {/* Video slot (Coming Soon — B6) */}
      <div className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-2">
          <Video className="size-4 text-neutral-400" aria-hidden="true" />
          <p className="text-sm font-medium text-neutral-500">{t('videoTitle')}</p>
        </div>
        <p className="text-xs text-neutral-400">{t('videoComingSoon')}</p>
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

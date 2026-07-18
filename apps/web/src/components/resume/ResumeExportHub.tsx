'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { CompletionRing } from '@/components/common/CompletionRing';
import { Spinner } from '@/components/ui/spinner';
import { getCandidateCompletion } from '@/lib/api/candidate';
import { getResume, type ResumeInfo } from '@/lib/api/resume';
import { ResumePreview } from './ResumePreview';
import { DownloadResumeButton } from './DownloadResumeButton';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];

interface ResumeExportHubProps {
  profile: CandidateProfile;
}

/**
 * Step-4 export hub (S7-F1) — REPLACES S1-F2's "coming soon" placeholder.
 * Composes the live PREVIEW (prominent), the server-computed completion ring
 * (reused), and Download PDF (the async generate→poll→download UX).
 *
 * Generating a resume is OPTIONAL — the stepper's Save & Continue (owned by
 * PreviewExportStep) reaches /dashboard whether or not a resume was generated.
 *
 * ── SEAM for S7-F2 ──────────────────────────────────────────────────────────
 * The Resume Settings toggle panel + Send-to-WhatsApp + Email-to-self mount in
 * the `data-f2-slot` region below. F1 only READS settings (via getResume) to
 * reflect them in the preview; F2 adds the EDITING (which live-updates this
 * preview) and the DELIVERY actions. When F2 changes a setting it should also
 * surface "regenerate to apply" — F1 already keeps a manual Regenerate always
 * available on the READY state.
 */
export function ResumeExportHub({ profile }: ResumeExportHubProps) {
  const t = useTranslations('resume');

  const [info, setInfo] = useState<ResumeInfo | null>(null);
  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [lastRenderedAt, setLastRenderedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getResume(), getCandidateCompletion().catch(() => null)])
      .then(([resumeInfo, comp]) => {
        if (!active) return;
        setInfo(resumeInfo);
        setLastRenderedAt(resumeInfo.lastRenderedAt ?? null);
        if (comp) setCompletion(comp);
      })
      .catch(() => {
        // A resume-info fetch failure must not block onboarding — the preview
        // simply can't render, but Save & Continue (in the parent) still works.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size={28} label={t('loading')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Completion ring — server-computed, never client-side. */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-neutral-700">{t('completionTitle')}</p>
        <CompletionRing
          pct={completion?.pct ?? profile.completionPct ?? 0}
          size={132}
          strokeWidth={12}
        />
      </div>

      {/* Live preview (prominent) — reflects the current Resume Settings. */}
      {info ? (
        <ResumePreview profile={profile} settings={info.settings} />
      ) : (
        <p className="text-sm text-neutral-500">{t('previewUnavailable')}</p>
      )}

      {/* Download PDF — the async generate→poll→download UX. */}
      <div className="flex flex-col gap-2">
        <DownloadResumeButton
          initialGeneration={info?.current ?? null}
          onGenerated={setLastRenderedAt}
        />
        {lastRenderedAt && (
          <p className="flex items-start gap-1.5 text-xs text-neutral-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t('regenerateHint')}
          </p>
        )}
      </div>

      {/* ── S7-F2 mounts the Resume Settings panel + delivery actions here. ── */}
      <div data-f2-slot="resume-settings-delivery" aria-hidden={!info} />
    </div>
  );
}

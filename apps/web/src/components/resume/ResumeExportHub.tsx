'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { CompletionRing } from '@/components/common/CompletionRing';
import { Spinner } from '@/components/ui/spinner';
import { getCandidateCompletion } from '@/lib/api/candidate';
import { getResume, type ResumeInfo } from '@/lib/api/resume';
import { ResumePreview } from './ResumePreview';
import { DownloadResumeButton } from './DownloadResumeButton';
import { ResumeSettingsPanel } from './ResumeSettingsPanel';
import { TemplateGallery } from './TemplateGallery';
import { RegeneratePrompt } from './RegeneratePrompt';
import { SendWhatsAppButton } from './SendWhatsAppButton';
import { EmailResumeButton } from './EmailResumeButton';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];
type ResumeSettings = components['schemas']['ResumeSettings'];

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
 * ── S7-F2 ───────────────────────────────────────────────────────────────────
 * The Resume Settings toggle panel + Send-to-WhatsApp + Email-to-self mount in
 * the seam below. Settings are OWNED here (lifted state) so that editing them in
 * the panel live-updates the preview; a committed change marks the last PDF
 * stale → the RegeneratePrompt (settings apply at GENERATION). F1's Regenerate /
 * Download PDF stays the actual regenerate action.
 */
export function ResumeExportHub({ profile }: ResumeExportHubProps) {
  const t = useTranslations('resume');

  const [info, setInfo] = useState<ResumeInfo | null>(null);
  const [settings, setSettings] = useState<ResumeSettings | null>(null);
  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [lastRenderedAt, setLastRenderedAt] = useState<string | null>(null);
  // A committed settings change since the last generation → the last PDF is stale.
  const [dirtySinceGenerate, setDirtySinceGenerate] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasGenerated = !!lastRenderedAt || info?.current?.status === 'READY';

  useEffect(() => {
    let active = true;
    Promise.all([getResume(), getCandidateCompletion().catch(() => null)])
      .then(([resumeInfo, comp]) => {
        if (!active) return;
        setInfo(resumeInfo);
        setSettings(resumeInfo.settings);
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
      <div className="flex flex-col items-center gap-3 rounded-[22px] bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/40 px-4 py-6">
        <p className="text-sm font-bold text-neutral-700">{t('completionTitle')}</p>
        {/* Same props as the Profile hero's ring — the two screens show the SAME
            number, so they must not render it in two different styles. */}
        <CompletionRing
          pct={completion?.pct ?? profile.completionPct ?? 0}
          size={150}
          strokeWidth={13}
          gradient
          gradientColors={['#0F3D91', '#F57C20']}
          glow
          milestones
        />
      </div>

      {/* Live preview (prominent) — reflects the current Resume Settings. */}
      {settings ? (
        <ResumePreview profile={profile} settings={settings} />
      ) : (
        <p className="text-sm text-neutral-600">{t('previewUnavailable')}</p>
      )}

      {/* Download PDF — the async generate→poll→download UX. A fresh generation
          reflects the current settings, so it clears the "stale" flag. */}
      <DownloadResumeButton
        initialGeneration={info?.current ?? null}
        onGenerated={(ts) => {
          setLastRenderedAt(ts);
          setDirtySinceGenerate(false);
        }}
      />

      {/* ── S7-F2: Resume Settings + delivery (mounted into F1's seam). ── */}
      {settings && (
        <div data-f2-slot="resume-settings-delivery" className="flex flex-col gap-4">
          {/* CR-001 F2: the template gallery. Shares the hub's settings state
              and its commit signal, so choosing a template marks the last PDF
              stale exactly the way a toggle does. */}
          <TemplateGallery
            settings={settings}
            onSettingsChange={setSettings}
            onCommitted={() => setDirtySinceGenerate(true)}
          />

          <ResumeSettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            onCommitted={() => setDirtySinceGenerate(true)}
          />

          {/* Editing settings doesn't change an already-generated PDF. */}
          {dirtySinceGenerate && hasGenerated && <RegeneratePrompt />}

          <div>
            <p className="mb-2.5 text-sm font-bold text-neutral-800">{t('delivery.title')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <SendWhatsAppButton />
              <EmailResumeButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

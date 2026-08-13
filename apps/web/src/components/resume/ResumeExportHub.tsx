'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { CompletionRing } from '@/components/common/CompletionRing';
import { Button } from '@/components/ui/button';
import { BrandLoader } from '@/components/ui/brand-loader';
import { getCandidateCompletion } from '@/lib/api/candidate';
import { useToast } from '@/components/ui/toast';
import { canExportResume, RESUME_MIN_COMPLETION_PCT } from '@/lib/resume/completionGate';
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
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [info, setInfo] = useState<ResumeInfo | null>(null);
  const [settings, setSettings] = useState<ResumeSettings | null>(null);
  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [lastRenderedAt, setLastRenderedAt] = useState<string | null>(null);
  // A committed settings change since the last generation → the last PDF is stale.
  const [dirtySinceGenerate, setDirtySinceGenerate] = useState(false);
  /**
   * The regenerate action published by DownloadResumeButton, rendered below the
   * template gallery. Held in a wrapper object because a bare function in state
   * would be mistaken for a lazy initialiser and invoked by React.
   */
  const [regenerateFn, setRegenerateFn] = useState<{ run: () => void } | null>(null);
  const regenerate = regenerateFn?.run ?? null;
  const setRegenerate = useCallback((fn: (() => void) | null) => {
    // Bail out when nothing actually changed. Wrapping in a fresh `{ run }`
    // unconditionally makes every publish a new object, so React can never
    // skip the re-render — and this state feeds a child effect, so a child
    // that re-publishes on each render would ping-pong with us forever. The
    // child keeps its own identity stable too; this is the second lock.
    setRegenerateFn((prev) => {
      if (!fn) return prev === null ? prev : null;
      return prev?.run === fn ? prev : { run: fn };
    });
  }, []);
  const [loading, setLoading] = useState(true);

  const completionPct = completion?.pct ?? profile.completionPct ?? 0;

  /**
   * The 80%-completion gate, shared by every export on this page: Download PDF,
   * the relocated Regenerate, re-download, Send to WhatsApp and Email to myself.
   *
   * Returns true when the action must NOT proceed, having already told the
   * candidate why. Buttons stay enabled on purpose — a disabled control gives
   * no reason, and the reason is the actionable part.
   *
   * The SAME rule and threshold as the Profile page's Download/Share, imported
   * from one module rather than restated, so the two screens cannot drift.
   *
   * `useCallback` is load-bearing, not decoration: DownloadResumeButton keeps
   * this behind a ref precisely because an unstable identity here would feed
   * the render loop this pair already had once.
   */
  const blockedByCompletion = useCallback((): boolean => {
    if (canExportResume(completionPct)) return false;
    showToast({
      message: tToast('resumeNeedsCompletion', { pct: RESUME_MIN_COMPLETION_PCT }),
      variant: 'warning',
    });
    return true;
  }, [completionPct, showToast, tToast]);

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
        <BrandLoader size="md" label={t('loading')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
        Completion — server-computed, never client-side.

        Laid out as a ROW from sm up: the ring on the start side with its label
        beside it. Stacked and centred, this was a wide band of empty space
        around one small ring on any screen past mobile.

        Ring props match the Profile hero's exactly — both screens render the
        SAME number, so rendering it in two different styles read as a bug.
      */}
      <section className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200/70 bg-gradient-to-br from-white to-[#E8F0FE]/50 px-5 py-5 shadow-sm sm:flex-row sm:gap-6 sm:px-6">
        {/*
          IDENTICAL to the Profile hero's ring — same size, same stroke, same
          panel treatment around it. The comment here already claimed they
          matched while the numbers said 132/12 against the hero's 150/13, so
          the same percentage rendered visibly differently on the two screens
          that show it. Anything changed here belongs in ProfileHero too.
        */}
        <div className="flex shrink-0 items-center justify-center rounded-2xl border border-neutral-200/60 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/50 px-6 py-5">
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
        <p className="text-center text-sm font-bold text-neutral-800 sm:text-start">
          {t('completionTitle')}
        </p>
      </section>

      {/* Live preview (prominent) — reflects the current Resume Settings. */}
      {settings ? (
        <ResumePreview profile={profile} settings={settings} />
      ) : (
        <p className="text-sm text-neutral-600">{t('previewUnavailable')}</p>
      )}

      {/* Download PDF — the async generate→poll→download UX. A fresh generation
          reflects the current settings, so it clears the "stale" flag.
          Carded so the primary action reads as a deliberate block rather than a
          button floating on the page background. */}
      <section className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
        <DownloadResumeButton
          isBlocked={blockedByCompletion}
          initialGeneration={info?.current ?? null}
          onGenerated={(ts) => {
            setLastRenderedAt(ts);
            setDirtySinceGenerate(false);
          }}
          // Regenerate is rendered below "Choose a template" instead — see the
          // section further down. The action itself is unchanged.
          showRegenerate={false}
          onRegenerateChange={setRegenerate}
        />
      </section>

      {/* ── S7-F2: Resume Settings + delivery (mounted into F1's seam). ── */}
      {settings && (
        <div data-f2-slot="resume-settings-delivery" className="flex flex-col gap-5">
          {/* Each group gets the same card treatment the profile and dashboard
              sections use, so this page stops looking like loose controls on a
              background and matches the rest of the app. */}
          <section className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
            {/* CR-001 F2: the template gallery. Shares the hub's settings state
                and its commit signal, so choosing a template marks the last PDF
                stale exactly the way a toggle does. */}
            <TemplateGallery
              settings={settings}
              onSettingsChange={setSettings}
              onCommitted={() => setDirtySinceGenerate(true)}
            />

            {/*
              Regenerate sits directly BELOW the template picker so the flow
              reads: choose a template → regenerate with it. It used to sit in
              the download card ABOVE the gallery, which asked the user to
              regenerate before they had picked what to regenerate INTO.

              Same handler as before — DownloadResumeButton still owns the
              generate/poll logic and publishes it; only the placement moved.
            */}
            {regenerate && (
              <div className="mt-4 flex flex-col gap-2 border-t border-neutral-100 pt-4">
                <p className="text-xs text-neutral-600">{t('regenerateHint')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => {
                    if (blockedByCompletion()) return;
                    regenerate();
                  }}
                  className="self-start"
                >
                  {t('regenerate')}
                </Button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
            <ResumeSettingsPanel
              settings={settings}
              onSettingsChange={setSettings}
              onCommitted={() => setDirtySinceGenerate(true)}
            />

            {/* Editing settings doesn't change an already-generated PDF. */}
            {dirtySinceGenerate && hasGenerated && <RegeneratePrompt />}
          </section>

          <section className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
            <p className="mb-2.5 text-sm font-bold text-neutral-800">{t('delivery.title')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <SendWhatsAppButton isBlocked={blockedByCompletion} />
              <EmailResumeButton isBlocked={blockedByCompletion} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { ResumeSummaryCard } from './ResumeSummaryCard';
import { DEFAULT_ABOUT_YOU } from '@/lib/resume/summaryDraft';
import { DownloadResumeButton } from './DownloadResumeButton';
import { ResumeSettingsPanel } from './ResumeSettingsPanel';
import { TemplateGallery } from './TemplateGallery';
import { RegeneratePrompt } from './RegeneratePrompt';
import { SendWhatsAppButton } from './SendWhatsAppButton';
import { EmailResumeButton } from './EmailResumeButton';
import { CoverLetterCard } from './CoverLetterCard';

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
  /**
   * The saved summary, held here rather than read from `profile` on every
   * render: the preview below must show the new intro the moment it saves, and
   * the `profile` prop is fetched once by the route/stepper above and never
   * refetched. Seeded from the prop, then owned by the last successful save.
   */
  const [summary, setSummary] = useState<string | null>(profile.summary ?? null);

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
        Completion ring BESIDE the intro, not stacked above it.

        Full-width and alone, the ring was a band of mostly empty space with one
        small circle in it, and it pushed the first thing the candidate actually
        has to DO below the fold. Paired with the intro they read as what they
        are: a status and a task, side by side. It collapses back to stacked
        below `lg`, where two columns would squeeze the textarea.

        Ring props stay IDENTICAL to the Profile hero's — both screens render
        the same number, so rendering it two different ways read as a bug.
      */}
      <div className="grid gap-5 lg:grid-cols-[auto_1fr] lg:items-stretch">
        <section className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-200/70 bg-gradient-to-br from-white to-[#E8F0FE]/50 px-5 py-5 shadow-sm sm:px-6">
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
          <p className="text-center text-sm font-bold text-neutral-800">{t('completionTitle')}</p>
        </section>

        {/* The intro the candidate writes, ABOVE the preview: it is an input,
            and the preview further down is where they see the result of it.
            Prefilled from their own profile when they have not written one — an
            empty box is a writing task most people skip. */}
        <ResumeSummaryCard value={summary} suggestion={DEFAULT_ABOUT_YOU} onSaved={setSummary} />
      </div>

      {/* Live preview (prominent) — reflects the current Resume Settings. */}
      {settings ? (
        <ResumePreview profile={{ ...profile, summary }} settings={settings} />
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
                {/*
                  Navy, not a plain outline.

                  It is a real action — it rebuilds the PDF — and as a bare
                  bordered button it read as disabled next to the cards above
                  it. Navy rather than the orange used for Download PDF, so the
                  hierarchy still holds: orange is the thing to press first,
                  this is the thing to press after changing something.
                */}
                <Button
                  type="button"
                  variant="brand"
                  size="md"
                  onClick={() => {
                    if (blockedByCompletion()) return;
                    regenerate();
                  }}
                  className="group self-start rounded-xl font-bold shadow-md transition-all hover:shadow-lg"
                >
                  <RefreshCw
                    className="size-4 transition-transform duration-300 group-hover:rotate-180"
                    aria-hidden="true"
                  />
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

          {/* The cover letter, between the settings and delivery: it is part of
              the application pack, not a delivery channel. */}
          <CoverLetterCard hasGenerated={hasGenerated} isBlocked={blockedByCompletion} />

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

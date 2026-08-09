'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markInterest, removeInterest } from '@/lib/api/employer-interest';

interface InterestButtonProps {
  candidateId: string;
  /** Server-known starting state, so the control does not flicker on mount. */
  initiallyInterested?: boolean;
  /** This company has already sent the outreach message to this candidate. */
  alreadyNotified?: boolean;
  onChange?: (interested: boolean) => void;
}

/**
 * Employer's "Interested" toggle on a candidate.
 *
 * Marking is deliberately SILENT — it shortlists, it does not message anyone.
 * Reaching out is a separate, explicit action on the Interested Candidates page,
 * because each message costs a paid WhatsApp conversation and lands on a
 * worker's phone. The helper text under the button says so, so an employer
 * cannot reasonably believe tapping this notified the candidate.
 */
export function InterestButton({
  candidateId,
  initiallyInterested = false,
  alreadyNotified = false,
  onChange,
}: InterestButtonProps) {
  const t = useTranslations('employer.interest');
  const [interested, setInterested] = useState(initiallyInterested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !interested;
    setBusy(true);
    setError(false);
    // Optimistic: the toggle is cheap and reversible, and a spinner on a
    // shortlist button reads as heavier than the action actually is.
    setInterested(next);
    try {
      if (next) await markInterest(candidateId);
      else await removeInterest(candidateId);
      onChange?.(next);
    } catch {
      setInterested(!next); // roll back to the truth
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Same card shell as CandidateFacts / ExperienceTimeline / SkillsList: each
    // section on this page owns its own card, so the page body stays a flat
    // stack. Rendering a bare control here made this block the odd one out.
    <section
      aria-labelledby="candidate-interest-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2 id="candidate-interest-heading" className="mb-4 text-base font-semibold text-neutral-900">
        {t('sectionTitle')}
      </h2>

      <div className="flex flex-col items-start gap-2">
        {/* `items-start` keeps the button its natural width — a stretched,
            full-card-width button read as a page-level primary action. */}
        <Button
          type="button"
          variant={interested ? 'primary' : 'outline'}
          size="sm"
          onClick={toggle}
          disabled={busy}
          aria-pressed={interested}
        >
          <Star className={interested ? 'size-4 fill-current' : 'size-4'} aria-hidden="true" />
          {interested ? t('marked') : t('mark')}
        </Button>

        <p className="text-xs text-neutral-600">
          {alreadyNotified ? t('alreadyNotified') : interested ? t('markedHint') : t('markHint')}
        </p>

        {error && (
          <p role="alert" className="text-xs text-error-fg">
            {t('toggleError')}
          </p>
        )}
      </div>
    </section>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const FEEDBACK_MAX = 500;

interface RejectDialogProps {
  name: string;
  busy: boolean;
  onConfirm: (feedback: string) => void;
  onClose: () => void;
}

/**
 * Reject confirm + an OPTIONAL feedback textarea. The dialog states the feedback
 * is VISIBLE TO THE CANDIDATE (there is no internal-notes field here — notes are
 * S6). ≤500 with a live counter. Focus-trapped.
 */
export function RejectDialog({ name, busy, onConfirm, onClose }: RejectDialogProps) {
  const t = useTranslations('applicants.rejectDialog');
  const [feedback, setFeedback] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const nodes = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]),textarea,[href],[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    nodes()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      const items = nodes();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-dialog-title"
        className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="reject-dialog-title" className="text-base font-semibold text-neutral-900">
          {t('title', { name })}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">{t('body')}</p>

        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="reject-feedback">{t('feedbackLabel')}</Label>
          <textarea
            id="reject-feedback"
            value={feedback}
            rows={3}
            maxLength={FEEDBACK_MAX}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('feedbackPlaceholder')}
            aria-describedby="reject-feedback-note reject-feedback-counter"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
          <p id="reject-feedback-note" className="text-xs text-warning-fg">
            {t('visibleNote')}
          </p>
          <p
            id="reject-feedback-counter"
            aria-live="polite"
            className={cn(
              'text-end text-xs',
              feedback.length >= FEEDBACK_MAX ? 'text-warning-fg' : 'text-neutral-600',
            )}
          >
            {t('counter', { n: feedback.length, max: FEEDBACK_MAX })}
          </p>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="min-h-11">
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(feedback.trim())}
            disabled={busy}
            className="min-h-11"
          >
            {t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

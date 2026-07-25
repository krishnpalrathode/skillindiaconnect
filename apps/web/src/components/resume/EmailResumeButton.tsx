'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api/client';
import { emailResume } from '@/lib/api/resume';

type Outcome = 'emailed' | 'notReady' | 'error';

/**
 * Email-to-self (S7-F2). The API sends ONLY to the candidate's own account email
 * — never an address from the request. Lighter than the WhatsApp path (no
 * dedicated cap), but the same 422 RESUME_NOT_READY discipline applies.
 */
export function EmailResumeButton() {
  const t = useTranslations('resume.delivery');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function send() {
    setSending(true);
    setOutcome(null);
    try {
      await emailResume();
      setOutcome('emailed');
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'RESUME_NOT_READY') {
        setOutcome('notReady');
      } else {
        setOutcome('error');
      }
    } finally {
      setSending(false);
    }
  }

  const message = outcome
    ? { emailed: t('emailed'), notReady: t('notReady'), error: t('error') }[outcome]
    : null;
  const isAlert = outcome === 'error';

  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={send}
        loading={sending}
        className="h-auto w-full justify-start gap-3 rounded-2xl border-neutral-200/80 bg-white px-4 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0F3D91]/30 hover:bg-[#E8F0FE]/40 hover:shadow-md"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]"
          aria-hidden="true"
        >
          <Mail className="size-5" />
        </span>
        <span className="font-semibold text-neutral-800">{t('emailButton')}</span>
      </Button>
      {message && (
        <p
          role={isAlert ? 'alert' : 'status'}
          aria-live={isAlert ? 'assertive' : 'polite'}
          className={`text-xs ${outcome === 'emailed' ? 'text-success-fg' : isAlert ? 'text-error-fg' : 'text-neutral-600'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

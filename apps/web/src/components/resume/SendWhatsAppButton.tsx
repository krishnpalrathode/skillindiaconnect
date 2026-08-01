'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api/client';
import { sendResumeWhatsApp } from '@/lib/api/resume';

/**
 * The four honest outcomes of a WhatsApp send. `fallback` is the critical one —
 * a not-whatsapp-capable candidate is TOLD their resume went to email instead,
 * never shown a success that implies WhatsApp (the FE half of B2's contract).
 */
type Outcome = 'whatsapp' | 'fallback' | 'notReady' | 'limit' | 'error';

export function SendWhatsAppButton() {
  const t = useTranslations('resume.delivery');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function send() {
    setSending(true);
    setOutcome(null);
    try {
      const res = await sendResumeWhatsApp();
      setOutcome(res.delivered === 'EMAIL_FALLBACK' ? 'fallback' : 'whatsapp');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'RESUME_NOT_READY') setOutcome('notReady');
        else if (err.error.code === 'RESUME_SEND_LIMIT_EXCEEDED') setOutcome('limit');
        else setOutcome('error');
      } else {
        setOutcome('error');
      }
    } finally {
      setSending(false);
    }
  }

  const message = outcome
    ? {
        whatsapp: t('waSent'),
        fallback: t('emailFallback'),
        notReady: t('notReady'),
        limit: t('limit'),
        error: t('error'),
      }[outcome]
    : null;

  // Success/degradation/limit are calm, expected states (aria-live polite);
  // only a genuine failure is an alert.
  const isAlert = outcome === 'error';
  const tone =
    outcome === 'whatsapp'
      ? 'text-success-fg'
      : outcome === 'error'
        ? 'text-error-fg'
        : 'text-neutral-600';

  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={send}
        loading={sending}
        className="h-auto w-full justify-start gap-3 rounded-2xl border-neutral-200/80 bg-white px-4 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-success-fg/40 hover:bg-success-bg/30 hover:shadow-md"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-bg text-success-fg"
          aria-hidden="true"
        >
          <MessageCircle className="size-5" />
        </span>
        <span className="font-semibold text-neutral-800">{t('whatsappButton')}</span>
      </Button>
      {message && (
        <p
          role={isAlert ? 'alert' : 'status'}
          aria-live={isAlert ? 'assertive' : 'polite'}
          className={`text-xs ${tone}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

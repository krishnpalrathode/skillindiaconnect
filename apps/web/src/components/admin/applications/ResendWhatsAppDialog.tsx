'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Mail } from 'lucide-react';
import { resendWhatsApp, type AdminApplicationDetail } from '@/lib/api/admin-applications';
import { ApiRequestError } from '@/lib/api/client';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';

type Outcome =
  | { kind: 'sent' }
  | { kind: 'email_fallback' }
  | { kind: 'limit' }
  | { kind: 'failed'; detail: string };

/**
 * The second-most consequential button in the console — it touches a real
 * worker's phone. Three disciplines, all visible in the dialog:
 *  - a MANDATORY reason (audited; a phone number never is);
 *  - the truth about history: the candidate's ORIGINAL notification date is
 *    NOT rewritten (selectedNotifiedAt is the guard, not "last notified");
 *  - honest outcomes: 429 is the guardrail working (calm, not an error), and
 *    a non-WhatsApp-capable candidate gets an email instead — SAY SO.
 *
 * Rendered for SELECTED applications only (the parent enforces it; the
 * backend 422s regardless).
 */
export function ResendWhatsAppDialog({
  application,
  onClose,
  onDone,
}: {
  application: AdminApplicationDetail;
  onClose: () => void;
  /** Called after a successful (or fallback) send so the parent can refetch. */
  onDone: () => void;
}) {
  const t = useTranslations('admin.applications.resend');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const candidate = application.candidateName ?? t('deletedUser');

  async function confirm() {
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    setBusy(true);
    try {
      const result = await resendWhatsApp(application.id, reason.trim());
      setOutcome(result.channel === 'whatsapp' ? { kind: 'sent' } : { kind: 'email_fallback' });
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.status === 429) {
        // The guardrail working, not an error.
        setOutcome({ kind: 'limit' });
      } else if (err instanceof ApiRequestError) {
        setOutcome({ kind: 'failed', detail: err.error.detail || t('failed') });
      } else {
        setOutcome({ kind: 'failed', detail: t('failed') });
      }
    } finally {
      setBusy(false);
    }
  }

  // Outcome state replaces the form — one clear answer, then close.
  if (outcome) {
    const calm = outcome.kind !== 'failed';
    return (
      <ActionDialogShell
        titleId="resend-outcome-title"
        title={t('outcomeTitle')}
        busy={false}
        confirmLabel={t('done')}
        onConfirm={onClose}
        onClose={onClose}
        cancelLabel={t('close')}
      >
        <div
          role={calm ? 'status' : 'alert'}
          className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${
            outcome.kind === 'sent'
              ? 'bg-success-bg/60 text-success-fg'
              : outcome.kind === 'failed'
                ? 'bg-error-bg/60 text-error-fg'
                : 'bg-neutral-100 text-neutral-700'
          }`}
        >
          {outcome.kind === 'sent' && (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {outcome.kind === 'email_fallback' && (
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <p>
            {outcome.kind === 'sent' && t('sentNote', { candidate })}
            {outcome.kind === 'email_fallback' && t('emailFallbackNote', { candidate })}
            {outcome.kind === 'limit' && t('limitNote')}
            {outcome.kind === 'failed' && outcome.detail}
          </p>
        </div>
      </ActionDialogShell>
    );
  }

  return (
    <ActionDialogShell
      titleId="resend-dialog-title"
      title={t('title', { candidate })}
      busy={busy}
      confirmLabel={t('confirm')}
      confirmDisabled={reason.trim().length === 0}
      onConfirm={() => void confirm()}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="mt-3 flex flex-col gap-3">
        {/* The consequence, plainly. */}
        <p className="text-sm text-neutral-700">{t('consequence', { candidate })}</p>
        {/* The truth about history. */}
        <p className="text-xs text-neutral-600">{t('originalDateUnchanged')}</p>

        <div>
          <label htmlFor="resend-reason" className="text-sm font-medium text-neutral-800">
            {t('reasonLabel')}
          </label>
          <p className="mt-0.5 text-xs text-neutral-600">{t('reasonAudited')}</p>
          <textarea
            id="resend-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setReasonError(false);
            }}
            maxLength={500}
            rows={2}
            required
            aria-required="true"
            aria-invalid={reasonError}
            aria-describedby={reasonError ? 'resend-reason-error' : undefined}
            className="mt-2 w-full rounded-lg border border-neutral-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
          {reasonError && (
            <p id="resend-reason-error" role="alert" className="mt-1 text-xs text-error-fg">
              {t('reasonRequired')}
            </p>
          )}
        </div>
      </div>
    </ActionDialogShell>
  );
}

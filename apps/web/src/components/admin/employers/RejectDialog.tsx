'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { ActionDialogShell } from './ActionDialogShell';

const REASON_MAX = 500;

/**
 * The reason is MANDATORY and EMPLOYER-VISIBLE — it lands in
 * `Company.rejectionReason` (their dashboard banner) and their rejection email.
 * The dialog says that in plain words, because the person typing needs to know a
 * real company will read this sentence. A lazy "n/a" here is tomorrow's support
 * ticket; the placeholder models what a useful reason looks like.
 *
 * Submit is blocked client-side while empty (and the API 422s regardless).
 */
export function RejectDialog({
  companyName,
  busy,
  serverError,
  onConfirm,
  onClose,
}: {
  companyName: string;
  busy: boolean;
  /** A 422 from the API (e.g. reason stripped) surfaces here rather than crashing. */
  serverError?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.employers.rejectDialog');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const empty = reason.trim().length === 0;
  const showEmptyError = touched && empty;

  return (
    <ActionDialogShell
      titleId="reject-employer-title"
      title={t('title', { name: companyName })}
      busy={busy}
      confirmLabel={t('confirm')}
      confirmVariant="destructive"
      confirmDisabled={empty}
      onConfirm={() => {
        setTouched(true);
        if (!empty) onConfirm(reason.trim());
      }}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      {/* The consequence, stated before the textarea — read first, type second. */}
      <p className="mt-2 text-sm font-medium text-neutral-700">{t('visibility')}</p>

      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="reject-reason" required>
          {t('reasonLabel')}
        </Label>
        <textarea
          id="reject-reason"
          value={reason}
          maxLength={REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t('reasonPlaceholder')}
          rows={3}
          aria-required="true"
          aria-invalid={showEmptyError || undefined}
          aria-describedby={showEmptyError ? 'reject-reason-error' : undefined}
          className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <div className="flex items-center justify-between">
          {showEmptyError ? (
            <p id="reject-reason-error" role="alert" className="text-xs font-medium text-error-fg">
              {t('reasonRequired')}
            </p>
          ) : (
            <span />
          )}
          <span className="text-xs text-neutral-400" aria-hidden="true">
            {reason.length}/{REASON_MAX}
          </span>
        </div>
        {serverError && (
          <p role="alert" className="text-xs font-medium text-error-fg">
            {serverError}
          </p>
        )}
      </div>
    </ActionDialogShell>
  );
}

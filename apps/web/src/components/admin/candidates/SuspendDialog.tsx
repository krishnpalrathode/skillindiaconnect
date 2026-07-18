'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';

const REASON_MAX = 500;

/**
 * Suspend a CANDIDATE account. The reason is MANDATORY (consistent with every
 * other admin corrective action) and lands in the audit trail. The copy names
 * the consequence — the person clicking needs to know exactly what a
 * suspension does to a real worker's account before they type a word.
 */
export function SuspendDialog({
  candidateName,
  busy,
  serverError,
  onConfirm,
  onClose,
}: {
  candidateName: string;
  busy: boolean;
  serverError?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.candidates.suspendDialog');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const empty = reason.trim().length === 0;
  const showEmptyError = touched && empty;

  return (
    <ActionDialogShell
      titleId="suspend-candidate-title"
      title={t('title', { name: candidateName })}
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
      {/* The consequence, stated before the textarea. */}
      <p className="mt-2 text-sm font-medium text-neutral-700">{t('consequence')}</p>

      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="suspend-candidate-reason" required>
          {t('reasonLabel')}
        </Label>
        <textarea
          id="suspend-candidate-reason"
          value={reason}
          maxLength={REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t('reasonPlaceholder')}
          rows={3}
          aria-required="true"
          aria-invalid={showEmptyError || undefined}
          aria-describedby={showEmptyError ? 'suspend-candidate-reason-error' : undefined}
          className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <div className="flex items-center justify-between">
          {showEmptyError ? (
            <p
              id="suspend-candidate-reason-error"
              role="alert"
              className="text-xs font-medium text-error-fg"
            >
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

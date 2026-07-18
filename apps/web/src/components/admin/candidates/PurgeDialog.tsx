'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';

const REASON_MAX = 500;

/**
 * THE GRAVITY UI. Purge irreversibly destroys a real person's data; the
 * backend rejects `confirm !== true`, but this dialog's job is to make sure a
 * HUMAN meant it. Four load-bearing elements — all of them, or the screen is
 * irresponsible:
 *
 *  1. WHAT IS DESTROYED, enumerated plainly (name, phone, email, dob, photo,
 *     every document — files removed from storage).
 *  2. WHAT SURVIVES, so the admin is not surprised either way: applications
 *     remain as anonymous records (employers keep their hiring history); the
 *     audit log keeps the fact that the account existed and was purged.
 *  3. "This cannot be undone." — once, prominently. No undo is offered
 *     anywhere because none exists.
 *  4. TYPE-TO-CONFIRM: the admin must type the candidate's FULL NAME — chosen
 *     over a fixed phrase because it forces reading WHO is being erased — plus
 *     a mandatory reason (audited). The confirm button stays disabled until
 *     BOTH hold; the match is exact (a near-miss or wrong case stays disabled).
 *
 * role="alertdialog": AT users hear the destructive nature announced. The
 * expected value is stated in visible TEXT (never only a placeholder), and the
 * disabled confirm's reason is conveyed via the requirements text the field is
 * described by.
 */
export function PurgeDialog({
  candidateName,
  busy,
  serverError,
  onConfirm,
  onClose,
}: {
  candidateName: string;
  busy: boolean;
  /** 409 (already purged) / 422 render calmly here — expected guard outcomes. */
  serverError?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.candidates.purgeDialog');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  const nameMatches = typed === candidateName; // EXACT — case and all
  const reasonPresent = reason.trim().length > 0;
  const ready = nameMatches && reasonPresent;

  return (
    <ActionDialogShell
      role="alertdialog"
      titleId="purge-candidate-title"
      title={t('title', { name: candidateName })}
      busy={busy}
      confirmLabel={t('confirm')}
      confirmVariant="destructive"
      confirmDisabled={!ready}
      onConfirm={() => {
        if (ready) onConfirm(reason.trim());
      }}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {/* 1. What is destroyed. */}
        <div className="rounded-lg bg-error-bg p-3">
          <p className="font-semibold text-error-fg">{t('destroysTitle')}</p>
          <p className="mt-1 text-error-fg/90">{t('destroysBody')}</p>
        </div>

        {/* 2. What survives. */}
        <div className="rounded-lg bg-neutral-50 p-3">
          <p className="font-semibold text-neutral-800">{t('survivesTitle')}</p>
          <p className="mt-1 text-neutral-600">{t('survivesBody')}</p>
        </div>

        {/* 3. Irreversibility — once, prominently. */}
        <p className="font-semibold text-error-fg">{t('irreversible')}</p>

        {/* 4a. The mandatory, audited reason. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purge-reason" required>
            {t('reasonLabel')}
          </Label>
          <textarea
            id="purge-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
            rows={2}
            aria-required="true"
            className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </div>

        {/* 4b. Type-to-confirm — the expected value stated in TEXT. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purge-confirm-name" required>
            {t('typeToConfirmLabel')}
          </Label>
          <p id="purge-confirm-expected" className="text-xs text-neutral-600">
            {t('typeToConfirmHint', { name: candidateName })}
          </p>
          <input
            id="purge-confirm-name"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-required="true"
            aria-describedby="purge-confirm-expected purge-confirm-requirements"
            className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </div>

        {/* The disabled-confirm reason, conveyed in text for everyone. */}
        {!ready && (
          <p id="purge-confirm-requirements" className="text-xs text-neutral-500">
            {t('requirements')}
          </p>
        )}

        {serverError && (
          <p role="alert" className="text-sm font-medium text-error-fg">
            {serverError}
          </p>
        )}
      </div>
    </ActionDialogShell>
  );
}

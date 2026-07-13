'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ActionDialogShell } from './ActionDialogShell';

/**
 * SUSPENDED → APPROVED. One fact the admin must not assume away: the jobs the
 * suspension paused STAY PAUSED — the employer resumes each one manually.
 * Reactivation restores the account, not the listings.
 */
export function ReactivateDialog({
  companyName,
  busy,
  onConfirm,
  onClose,
}: {
  companyName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.employers.reactivateDialog');

  return (
    <ActionDialogShell
      titleId="reactivate-employer-title"
      title={t('title', { name: companyName })}
      busy={busy}
      confirmLabel={t('confirm')}
      onConfirm={onConfirm}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <p className="mt-2 text-sm text-neutral-600">{t('body')}</p>
      <p className="mt-2 text-sm text-neutral-600">{t('jobsStayPaused')}</p>
    </ActionDialogShell>
  );
}

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ActionDialogShell } from './ActionDialogShell';

/**
 * A light confirm — approval is the happy path, not a hazard. The one thing the
 * admin should consciously register: the company can post jobs the moment they
 * click, so the body says exactly that.
 */
export function ApproveDialog({
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
  const t = useTranslations('admin.employers.approveDialog');

  return (
    <ActionDialogShell
      titleId="approve-employer-title"
      title={t('title', { name: companyName })}
      busy={busy}
      confirmLabel={t('confirm')}
      onConfirm={onConfirm}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <p className="mt-2 text-sm text-neutral-600">{t('body')}</p>
    </ActionDialogShell>
  );
}

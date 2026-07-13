'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { ActionDialogShell } from './ActionDialogShell';

/**
 * Suspension cascades: the S2-B5 rule pauses ALL of the company's active jobs
 * the moment this confirms. The admin learns that HERE, before clicking — not
 * from a support ticket after.
 *
 * DELIBERATE DEVIATION, stated: the unit spec asked for a mandatory reason, but
 * `POST /admin/employers/{id}/suspend` takes no body and the schema has no
 * suspension-reason field (only `rejectionReason` exists). Collecting text that
 * silently goes nowhere would be worse than not asking — the admin would believe
 * the employer sees it. So this dialog is an explicit consequence-confirm, and a
 * stored suspension reason is a backend change to request, not a UI pretense.
 */
export function SuspendDialog({
  companyName,
  activeJobsHint,
  busy,
  onConfirm,
  onClose,
}: {
  companyName: string;
  /** Optional "and their N active jobs" refinement when the caller knows it. */
  activeJobsHint?: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.employers.suspendDialog');

  return (
    <ActionDialogShell
      titleId="suspend-employer-title"
      title={t('title', { name: companyName })}
      busy={busy}
      confirmLabel={t('confirm')}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-bg p-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
        <p className="text-sm text-warning-fg">
          {activeJobsHint !== undefined && activeJobsHint > 0
            ? t('consequenceWithCount', { count: activeJobsHint })
            : t('consequence')}
        </p>
      </div>
      <p className="mt-2 text-sm text-neutral-600">{t('body')}</p>
    </ActionDialogShell>
  );
}

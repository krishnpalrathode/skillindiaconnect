'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import {
  overrideApplicationStatus,
  type AdminApplicationDetail,
  type ApplicationStatus,
} from '@/lib/api/admin-applications';
import { ApiRequestError } from '@/lib/api/client';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';

const ALL_STATUSES: ApplicationStatus[] = ['PENDING', 'SHORTLISTED', 'SELECTED', 'REJECTED'];

/**
 * The corrective override — ANY transition (admins are not forward-only).
 *
 * Two truths the dialog must state BEFORE the admin types:
 *  1. Where the reason goes: the audit log and other admins — the CANDIDATE
 *     SEES ONLY A NEUTRAL ENTRY ("Status updated by SkillIndiaConnect"). An
 *     admin writing a reason they believe the candidate will read is a real
 *     and unkind failure mode.
 *  2. The WhatsApp guard, made legible: re-selecting an already-notified
 *     application sends NO new WhatsApp (selectedNotifiedAt is a guard) —
 *     the manual resend is the tool for that, and the dialog points to it.
 *
 * Confirm → PATCH → onDone (the parent refetches; never optimistic).
 */
export function OverrideDialog({
  application,
  onClose,
  onDone,
}: {
  application: AdminApplicationDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('admin.applications.override');
  const [target, setTarget] = useState<ApplicationStatus | ''>('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverNote, setServerNote] = useState<string | null>(null);

  const candidate = application.candidateName ?? t('deletedUser');
  const options = ALL_STATUSES.filter((s) => s !== application.status);
  const alreadyNotified = application.selectedNotifiedAt != null;
  const reSelectWarning = target === 'SELECTED' && alreadyNotified;

  async function confirm() {
    if (!target) return;
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    setBusy(true);
    setServerNote(null);
    try {
      await overrideApplicationStatus(application.id, target, reason.trim());
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.status === 422) {
        // Same-state / illegal / reason-required — calm, specific, in-dialog.
        setServerNote(err.error.detail || t('rejectedByServer'));
      } else {
        setServerNote(t('failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ActionDialogShell
      titleId="override-dialog-title"
      title={
        target
          ? t('titleWithTarget', {
              candidate,
              from: application.status,
              to: target,
            })
          : t('title', { candidate })
      }
      busy={busy}
      confirmLabel={t('confirm')}
      confirmVariant="destructive"
      confirmDisabled={!target || reason.trim().length === 0}
      onConfirm={() => void confirm()}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label htmlFor="override-target" className="text-sm font-medium text-neutral-800">
            {t('targetLabel')}
          </label>
          <select
            id="override-target"
            value={target}
            onChange={(e) => setTarget(e.target.value as ApplicationStatus)}
            className="mt-1 flex h-11 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="" disabled>
              {t('targetPlaceholder')}
            </option>
            {options.map((s) => (
              <option key={s} value={s}>
                {t(`statusName.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {/* The guard made legible — BEFORE they confirm. */}
        {reSelectWarning && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-info bg-info-bg p-3"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-info-fg" aria-hidden="true" />
            <p className="text-xs text-info-fg">{t('noNewWhatsApp')}</p>
          </div>
        )}

        <div>
          <label htmlFor="override-reason" className="text-sm font-medium text-neutral-800">
            {t('reasonLabel')}
          </label>
          {/* The truth about visibility — stated before the admin types a word. */}
          <p className="mt-0.5 text-xs text-neutral-600">{t('reasonVisibility')}</p>
          <textarea
            id="override-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setReasonError(false);
            }}
            maxLength={1000}
            rows={3}
            required
            aria-required="true"
            aria-invalid={reasonError}
            aria-describedby={reasonError ? 'override-reason-error' : undefined}
            className="mt-2 w-full rounded-lg border border-neutral-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
          {reasonError && (
            <p id="override-reason-error" role="alert" className="mt-1 text-xs text-error-fg">
              {t('reasonRequired')}
            </p>
          )}
        </div>

        {serverNote && (
          <p role="status" className="rounded-lg bg-neutral-100 p-2 text-xs text-neutral-600">
            {serverNote}
          </p>
        )}
      </div>
    </ActionDialogShell>
  );
}

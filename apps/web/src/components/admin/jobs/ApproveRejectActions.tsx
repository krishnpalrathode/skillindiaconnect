'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { reviewJob, type AdminJobDetail } from '@/lib/api/admin-jobs';
import { ApiRequestError, type ApiError } from '@/lib/api/client';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';
import { Button } from '@/components/ui/button';
import { GateFailureExplainer } from './GateFailureExplainer';

/**
 * The PENDING_REVIEW resolution. Approve RE-RUNS the publish gates server-side
 * — so it can honestly FAIL, and each failure renders the GateFailureExplainer
 * with its remedy (never a bare error toast). Reject requires a MANDATORY
 * reason, and the copy says the truth about it: the reason is EMPLOYER-VISIBLE
 * (it tells them what to fix before resubmitting).
 *
 * Refetch-after-resolve (via onResolved), never optimistic — a moderation
 * decision is consequential and the row must reflect what the server did.
 */
export type ReviewOutcome = 'approved' | 'rejected' | 'conflict';

export function ApproveRejectActions({
  job,
  onResolved,
}: {
  job: AdminJobDetail;
  /**
   * Called after ANY server-confirmed resolution (approve, reject, or a 409).
   * The PARENT renders the outcome note — a resolved job leaves
   * PENDING_REVIEW, so this section unmounts on the refetch.
   */
  onResolved: (outcome: ReviewOutcome) => void;
}) {
  const t = useTranslations('admin.jobs.review');
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [gateError, setGateError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);

  async function confirmApprove() {
    setBusy(true);
    setGateError(null);
    try {
      await reviewJob(job.id, 'APPROVE');
      setDialog(null);
      onResolved('approved');
    } catch (err) {
      setDialog(null);
      if (err instanceof ApiRequestError) {
        if (err.error.status === 409) {
          // Someone else resolved it first — calm, then converge on the truth.
          setConflict(true);
          onResolved('conflict');
        } else {
          // The gate ladder spoke — explain WHY, with the remedy.
          setGateError(err.error);
        }
      } else {
        setGateError({
          code: 'UNKNOWN_ERROR',
          status: 0,
          title: 'Error',
          detail: t('approveFailedGeneric'),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject() {
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    setBusy(true);
    try {
      await reviewJob(job.id, 'REJECT', reason.trim());
      setDialog(null);
      onResolved('rejected');
    } catch (err) {
      setDialog(null);
      if (err instanceof ApiRequestError && err.error.status === 409) {
        setConflict(true);
        onResolved('conflict');
      } else if (err instanceof ApiRequestError) {
        setGateError(err.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const openReject = () => {
    setGateError(null);
    setReason('');
    setReasonError(false);
    setDialog('reject');
  };

  return (
    <PermissionGate permission="jobs.moderate">
      <section
        aria-labelledby="review-actions-heading"
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
      >
        <div>
          <h2 id="review-actions-heading" className="text-sm font-semibold text-neutral-900">
            {t('heading')}
          </h2>
          {/* The re-run is stated up front — an admin should know approval is a gate, not a rubber stamp. */}
          <p className="mt-0.5 text-xs text-neutral-500">{t('gatesNote')}</p>
        </div>

        {conflict && (
          <p role="status" className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-600">
            {t('alreadyResolved')}
          </p>
        )}

        {gateError && (
          <GateFailureExplainer
            error={gateError}
            companyId={job.companyId}
            companyName={job.companyName}
            onReject={openReject}
          />
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('approve')} disabled={busy}>
            {t('approve')}
          </Button>
          <Button variant="destructive" onClick={openReject} disabled={busy}>
            {t('reject')}
          </Button>
        </div>
      </section>

      {dialog === 'approve' && (
        <ActionDialogShell
          titleId="approve-job-title"
          title={t('approveDialog.title', { title: job.title })}
          busy={busy}
          confirmLabel={t('approveDialog.confirm')}
          onConfirm={() => void confirmApprove()}
          onClose={() => setDialog(null)}
          cancelLabel={t('cancel')}
        >
          <p className="mt-2 text-sm text-neutral-600">{t('approveDialog.body')}</p>
        </ActionDialogShell>
      )}

      {dialog === 'reject' && (
        <ActionDialogShell
          titleId="reject-job-title"
          title={t('rejectDialog.title', { title: job.title })}
          busy={busy}
          confirmLabel={t('rejectDialog.confirm')}
          confirmVariant="destructive"
          confirmDisabled={reason.trim().length === 0}
          onConfirm={() => void confirmReject()}
          onClose={() => setDialog(null)}
          cancelLabel={t('cancel')}
        >
          <p className="mt-2 text-sm text-neutral-600">{t('rejectDialog.body')}</p>
          <div className="mt-3">
            <label htmlFor="reject-reason" className="text-sm font-medium text-neutral-800">
              {t('rejectDialog.reasonLabel')}
            </label>
            {/* The truth about visibility, BEFORE they type: the employer reads this. */}
            <p className="mt-0.5 text-xs text-neutral-500">{t('rejectDialog.employerVisible')}</p>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setReasonError(false);
              }}
              maxLength={500}
              rows={3}
              required
              aria-required="true"
              aria-invalid={reasonError}
              aria-describedby={reasonError ? 'reject-reason-error' : undefined}
              className="mt-2 w-full rounded-lg border border-neutral-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            />
            {reasonError && (
              <p id="reject-reason-error" role="alert" className="mt-1 text-xs text-error-fg">
                {t('rejectDialog.reasonRequired')}
              </p>
            )}
          </div>
        </ActionDialogShell>
      )}
    </PermissionGate>
  );
}

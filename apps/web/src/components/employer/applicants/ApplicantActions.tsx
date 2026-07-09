'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { SelectConfirmDialog } from './SelectConfirmDialog';
import { RejectDialog } from './RejectDialog';

type ApplicantCard = components['schemas']['ApplicantCard'];
type ApplicationStatus = components['schemas']['ApplicationStatus'];

interface ApplicantActionsProps {
  applicant: ApplicantCard;
  busy: boolean;
  onTransition: (to: ApplicationStatus, opts?: { rejectionFeedback?: string }) => void;
}

/**
 * The forward-only matrix as buttons:
 *   PENDING     → Shortlist · Select · Reject
 *   SHORTLISTED → Select · Reject
 *   SELECTED / REJECTED → none (terminal; admin corrections are S6, NOT hinted here).
 * Shortlist is one-tap; Select/Reject go through their confirm dialogs.
 */
export function ApplicantActions({ applicant, busy, onTransition }: ApplicantActionsProps) {
  const t = useTranslations('applicants.actions');
  const [dialog, setDialog] = useState<'select' | 'reject' | null>(null);
  const name = applicant.fullName;
  const { status } = applicant;

  if (status === 'SELECTED' || status === 'REJECTED') return null;

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'PENDING' && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          className="min-h-11"
          aria-label={t('shortlistName', { name })}
          onClick={() => onTransition('SHORTLISTED')}
        >
          {t('shortlist')}
        </Button>
      )}
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        className="min-h-11"
        aria-label={t('selectName', { name })}
        onClick={() => setDialog('select')}
      >
        {t('select')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="min-h-11"
        aria-label={t('rejectName', { name })}
        onClick={() => setDialog('reject')}
      >
        {t('reject')}
      </Button>

      {dialog === 'select' && (
        <SelectConfirmDialog
          name={name}
          busy={busy}
          onConfirm={() => {
            setDialog(null);
            onTransition('SELECTED');
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reject' && (
        <RejectDialog
          name={name}
          busy={busy}
          onConfirm={(fb) => {
            setDialog(null);
            onTransition('REJECTED', fb ? { rejectionFeedback: fb } : undefined);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

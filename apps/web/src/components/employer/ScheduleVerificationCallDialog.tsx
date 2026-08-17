'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogShell } from '@/components/ui/dialog-shell';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api/client';
import { scheduleVerificationCall, type VerificationCallRequest } from '@/lib/api/employer';

const NOTE_MAX_LENGTH = 500;

/** How far ahead the API accepts a slot — mirrors MAX_SLOT_DAYS_AHEAD server-side. */
const MAX_DAYS_AHEAD = 30;

function isoDay(d: Date): string {
  // Local calendar day, not UTC: `toISOString().slice(0,10)` rolls over a day
  // early for anyone east of Greenwich, which would make "today" unselectable
  // for the entire Indian and Gulf audience this is built for.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface ScheduleVerificationCallDialogProps {
  /** Pre-fills when re-scheduling an existing request. */
  existing?: VerificationCallRequest | null;
  onScheduled: (booking: VerificationCallRequest) => void;
  onClose: () => void;
}

/**
 * Pick a date and time for the verification call.
 *
 * Two native inputs rather than a bespoke picker: `type="date"` and
 * `type="time"` give Android and iOS their own wheel UI, which is the one this
 * audience already knows and the one that works without JavaScript-heavy
 * widgets on a cheap phone.
 *
 * The two fields are combined into a LOCAL Date and sent as an instant. That
 * conversion is the whole subtlety here — an employer in Kerala booking "10:00"
 * and an admin in Dubai reading it must be looking at the same moment, and the
 * only way that holds is if the offset travels with the value instead of a bare
 * "10:00" string being reinterpreted at the other end.
 */
export function ScheduleVerificationCallDialog({
  existing,
  onScheduled,
  onClose,
}: ScheduleVerificationCallDialogProps) {
  const t = useTranslations('employer.verificationCall');
  const { showToast } = useToast();

  const now = new Date();
  const maxDate = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const existingDate = existing ? new Date(existing.slotAt) : null;
  const [date, setDate] = useState(existingDate ? isoDay(existingDate) : isoDay(now));
  const [time, setTime] = useState(
    existingDate
      ? `${String(existingDate.getHours()).padStart(2, '0')}:${String(existingDate.getMinutes()).padStart(2, '0')}`
      : '10:00',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);

    if (!date || !time) {
      setError(t('errRequired'));
      return;
    }

    // `new Date('YYYY-MM-DDTHH:mm')` with no zone is parsed as LOCAL time by
    // every browser — which is exactly what the employer meant by typing it.
    const slot = new Date(`${date}T${time}`);
    if (Number.isNaN(slot.getTime())) {
      setError(t('errRequired'));
      return;
    }
    // Checked here as well as server-side so the common mistake (a time earlier
    // today) is caught without a round trip.
    if (slot.getTime() <= Date.now()) {
      setError(t('errPast'));
      return;
    }

    setBusy(true);
    try {
      const booking = await scheduleVerificationCall({
        slotAt: slot.toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      showToast({ message: t('booked'), variant: 'success' });
      onScheduled(booking);
    } catch (err) {
      // Surface the server's reason rather than a generic failure — "your
      // company is already approved" and "that slot is too far out" need
      // different responses from the employer.
      const code = err instanceof ApiRequestError ? err.error.code : null;
      setError(
        code === 'SLOT_IN_PAST'
          ? t('errPast')
          : code === 'SLOT_TOO_FAR'
            ? t('errTooFar', { days: MAX_DAYS_AHEAD })
            : code === 'VERIFICATION_CALL_NOT_APPLICABLE'
              ? t('errNotApplicable')
              : t('errGeneric'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      titleId="schedule-call-title"
      title={existing ? t('rescheduleTitle') : t('title')}
      busy={busy}
      confirmLabel={existing ? t('rescheduleConfirm') : t('confirm')}
      onConfirm={() => void submit()}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700">{t('body')}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="call-date" label={t('dateLabel')}>
            <Input
              id="call-date"
              type="date"
              value={date}
              min={isoDay(now)}
              max={isoDay(maxDate)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field id="call-time" label={t('timeLabel')}>
            <Input
              id="call-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        {/* States the zone the times are in. Without it an employer abroad has
            no way to know whether "10:00" means theirs or ours. */}
        <p className="text-xs text-neutral-600">
          {t('timezoneHint', {
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time',
          })}
        </p>

        <Field id="call-note" label={t('noteLabel')} hint={t('noteHint')}>
          <textarea
            id="call-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_LENGTH))}
            rows={3}
            maxLength={NOTE_MAX_LENGTH}
            className="w-full rounded-lg border border-neutral-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm font-medium text-error-fg">
            {error}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

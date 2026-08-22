'use client';

import React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CalendarClock } from 'lucide-react';
import { DialogShell } from '@/components/ui/dialog-shell';
import { formatDate } from '@/lib/format/date';

/**
 * Tells the employer their posting has a lifetime, at the moment it acquires one.
 *
 * ── Why the DATE and not a hardcoded number of days ─────────────────────────
 * How long a job stays live is `jobs.auto_archive_days` in Settings — a
 * Super-Admin can change it, and changing it must not silently turn this
 * message into a lie. The API already returns the computed `autoArchiveAt` on
 * the published job, so the notice reads the real deadline off the real record.
 * Nothing here needs touching if the platform's job lifetime changes.
 *
 * ── Why it says ARCHIVED and not deleted ────────────────────────────────────
 * Because that is what happens: the job transitions ACTIVE→ARCHIVED. It stops
 * being visible to candidates, but the employer keeps it under My Jobs with its
 * applicants intact and can repost it. Telling someone their job will be
 * "deleted" would have them re-typing a posting they never actually lost.
 */
export function PublishedNotice({
  autoArchiveAt,
  onClose,
}: {
  /**
   * When the job will be archived. NULL when the job went to PENDING_REVIEW
   * instead of ACTIVE — the platform requires admin approval, so the clock has
   * not started yet and promising a date would be wrong.
   */
  autoArchiveAt: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('jobform.published');
  const locale = useLocale();

  const pendingReview = !autoArchiveAt;

  /*
    Whole days, rounded UP, measured from now. Rounding down would show "44
    days" for something with 44 days and 20 hours left, which reads as the
    platform quietly shortening the posting.
  */
  const daysLeft = autoArchiveAt
    ? Math.max(
        0,
        Math.ceil((new Date(autoArchiveAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : 0;

  return (
    <DialogShell
      titleId="job-published-title"
      title={pendingReview ? t('pendingTitle') : t('liveTitle')}
      busy={false}
      confirmLabel={t('confirm')}
      onConfirm={onClose}
      onClose={onClose}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]"
        >
          <CalendarClock className="size-4" />
        </span>
        <div className="min-w-0 space-y-2 text-sm text-neutral-700">
          {pendingReview ? (
            <>
              <p>{t('pendingBody')}</p>
              <p className="text-xs text-neutral-600">{t('pendingHint')}</p>
            </>
          ) : (
            <>
              <p>
                {t.rich('liveBody', {
                  date: () => (
                    <strong className="font-semibold text-neutral-900">
                      {formatDate(autoArchiveAt, locale)}
                    </strong>
                  ),
                  days: () => (
                    <strong className="font-semibold text-neutral-900">{daysLeft}</strong>
                  ),
                })}
              </p>
              {/* States plainly that archived is not lost — the whole point of
                  the distinction, and the thing an employer would otherwise
                  assume the wrong way round. */}
              <p className="text-xs text-neutral-600">{t('archiveHint')}</p>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

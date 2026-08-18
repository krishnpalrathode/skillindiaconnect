'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Download, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api/client';
import { getCoverLetterDownloadUrl, emailCoverLetter } from '@/lib/api/resume';

interface CoverLetterCardProps {
  /** True once a resume has been generated — the letter ships with it. */
  hasGenerated: boolean;
  /** The shared completion gate; returns true when the action must not proceed. */
  isBlocked: () => boolean;
}

/**
 * Download / email the cover letter that was rendered with the resume.
 *
 * ── No generate button, on purpose ─────────────────────────────────────────
 * The letter comes out of the SAME worker job as the CV, from the same profile
 * snapshot. A separate "generate cover letter" action would let the two drift
 * apart — a letter quoting a job title the CV beside it no longer claims — and
 * would make the candidate wait through a second Chromium render for a document
 * they were going to send with the first one anyway.
 *
 * So the only states are: no resume yet (explain that), or ready (two buttons).
 *
 * ── COVER_LETTER_NOT_FOUND is not an error to apologise for ───────────────
 * A resume generated before this feature has no letter attached. That comes
 * back as its own code, and the honest response is "regenerate" — not the
 * generic save-failed toast, which would leave the candidate with no idea what
 * to do next.
 */
export function CoverLetterCard({ hasGenerated, isBlocked }: CoverLetterCardProps) {
  const t = useTranslations('resume.coverLetter');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);

  /** Maps the one error worth explaining; everything else is a generic failure. */
  function reportError(err: unknown) {
    if (err instanceof ApiRequestError && err.error.code === 'COVER_LETTER_NOT_FOUND') {
      showToast({ message: t('errRegenerate'), variant: 'warning' });
      return;
    }
    showToast({ message: tToast('saveFailed'), variant: 'error' });
  }

  async function handleDownload() {
    if (downloading || isBlocked()) return;
    setDownloading(true);
    try {
      const { url } = await getCoverLetterDownloadUrl();
      // Same mechanism the resume download uses: the signed url is short-lived,
      // so it is fetched at click time and handed straight to the browser.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      reportError(err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleEmail() {
    if (emailing || isBlocked()) return;
    setEmailing(true);
    try {
      await emailCoverLetter();
      showToast({ message: t('emailQueued'), variant: 'success' });
    } catch (err) {
      reportError(err);
    } finally {
      setEmailing(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]"
          aria-hidden="true"
        >
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-neutral-800">{t('title')}</p>
          <p className="mt-0.5 text-xs leading-snug text-neutral-600">{t('hint')}</p>
        </div>
      </div>

      {hasGenerated ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? <Spinner size={14} label="" /> : <Download className="size-4" />}
            {t('download')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => void handleEmail()}
            disabled={emailing}
          >
            {emailing ? <Spinner size={14} label="" /> : <Mail className="size-4" />}
            {t('email')}
          </Button>
        </div>
      ) : (
        /* Not an error state — they simply have not generated yet. Says what to
           do rather than showing two buttons that would only fail. */
        <p className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          {t('generateFirst')}
        </p>
      )}
    </section>
  );
}

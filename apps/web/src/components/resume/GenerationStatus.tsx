'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Clock, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLoader } from '@/components/ui/brand-loader';

export type GenerationPhase = 'generating' | 'ready' | 'failed' | 'timeout';

interface GenerationStatusProps {
  phase: GenerationPhase;
  /** READY only — re-trigger the download (re-mints the signed url if expired). */
  onDownload?: () => void;
  /** Whether a re-download is currently in flight (disables the button). */
  downloading?: boolean;
  /** FAILED / TIMEOUT — regenerate from scratch. */
  onRetry?: () => void;
}

/**
 * The honest generation states (S7-F1) — the mirror of the payments
 * pending→confirmed panel (`PaymentConfirming`), reused vocabulary:
 *
 *   - `generating` — a calm spinner-with-context. NEVER a stale/absent PDF
 *     presented as ready; the download link does not exist in this state.
 *   - `ready`      — success + a real download action (the signed url).
 *   - `failed`     — the worker reported a render failure → regenerate.
 *   - `timeout`    — polling spent its budget without READY → an honest
 *     "taking longer than expected", never a false-ready, with a retry.
 *
 * `aria-live=polite` announces every transition; FAILED is an `alert`.
 */
export function GenerationStatus({
  phase,
  onDownload,
  downloading,
  onRetry,
}: GenerationStatusProps) {
  const t = useTranslations('resume.status');

  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-3 rounded-[22px] border border-neutral-200/70 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/30 p-6 text-center shadow-sm"
    >
      {phase === 'generating' && (
        <>
          {/* Decorative here: the visible heading below already says
              "Generating your resume…", and this whole block is an aria-live
              region — BrandLoader's own sr-only label would announce the same
              sentence a second time. */}
          <span aria-hidden="true">
            <BrandLoader size="md" />
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('generatingTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('generatingBody')}</p>
          </div>
        </>
      )}

      {phase === 'ready' && (
        <>
          <CheckCircle2 className="size-9 text-success-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('readyTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('readyBody')}</p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onDownload}
            loading={downloading}
          >
            <Download className="size-4" aria-hidden="true" />
            {t('downloadAgain')}
          </Button>
        </>
      )}

      {phase === 'failed' && (
        <div role="alert" className="flex flex-col items-center gap-3">
          <XCircle className="size-9 text-error-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('failedTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('failedBody')}</p>
          </div>
          <Button type="button" variant="primary" size="md" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      )}

      {phase === 'timeout' && (
        <>
          <Clock className="size-9 text-warning-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('timeoutTitle')}</p>
            <p className="mt-1 text-xs text-neutral-600">{t('timeoutBody')}</p>
          </div>
          <Button type="button" variant="primary" size="md" onClick={onRetry}>
            {t('retry')}
          </Button>
        </>
      )}
    </div>
  );
}

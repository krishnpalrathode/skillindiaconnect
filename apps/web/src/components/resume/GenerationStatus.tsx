'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Clock, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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
      className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center"
    >
      {phase === 'generating' && (
        <>
          <Spinner size={28} label={t('generatingTitle')} />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('generatingTitle')}</p>
            <p className="mt-1 text-xs text-neutral-500">{t('generatingBody')}</p>
          </div>
        </>
      )}

      {phase === 'ready' && (
        <>
          <CheckCircle2 className="size-9 text-success-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-neutral-900">{t('readyTitle')}</p>
            <p className="mt-1 text-xs text-neutral-500">{t('readyBody')}</p>
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
            <p className="mt-1 text-xs text-neutral-500">{t('failedBody')}</p>
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
            <p className="mt-1 text-xs text-neutral-500">{t('timeoutBody')}</p>
          </div>
          <Button type="button" variant="primary" size="md" onClick={onRetry}>
            {t('retry')}
          </Button>
        </>
      )}
    </div>
  );
}

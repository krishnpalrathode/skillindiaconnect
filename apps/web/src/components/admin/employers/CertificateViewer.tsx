'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileQuestion, RefreshCw } from 'lucide-react';
import { getCertificateUrl } from '@/lib/api/admin-employers';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type ViewerState =
  | { kind: 'loading' }
  | { kind: 'loaded'; url: string }
  | { kind: 'none' } // 404: no certificate on file
  | { kind: 'error' }; // network / expired / anything else

/** Crude but sufficient: the signed URL's path tells us how to render it. */
function isImage(url: string): boolean {
  return /\.(png|jpe?g|webp)(\?|$)/i.test(url);
}

/**
 * THE review centerpiece. Approving a company means checking the registration
 * form against this document — if it doesn't render, Screen 24 has no purpose.
 *
 * Behaviours that matter:
 * - The signed URL is minted ON OPEN, not eagerly per row: every issuance writes
 *   a `document.viewed` audit row naming this admin, so fetching it for rows
 *   nobody reviews would flood the trail with grants that never happened.
 * - The URL is SHORT-EXPIRY BY DESIGN (~5 min). An admin who reads slowly, takes
 *   a call, or comes back to the tab will find a dead link — that is the system
 *   working, not breaking, so the failure state says so and offers a one-click
 *   re-mint ("refresh link") instead of a scary error.
 * - 404 = no certificate on file. NOT a blocker: approving without a certificate
 *   is the admin's judgement call to make. It is stated plainly and visibly so
 *   the call is made consciously, never because the gap was easy to miss.
 * - PDF renders in an <iframe>, images in an <img>; both get an "open in new
 *   tab" link — which doubles as the text alternative for AT users who can't
 *   read an embedded document.
 */
export function CertificateViewer({ companyId }: { companyId: string }) {
  const t = useTranslations('admin.employers.certificate');
  const [state, setState] = useState<ViewerState>({ kind: 'loading' });

  const fetchUrl = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const grant = await getCertificateUrl(companyId);
      setState({ kind: 'loaded', url: grant.url });
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.status === 404) {
        setState({ kind: 'none' });
      } else {
        setState({ kind: 'error' });
      }
    }
  }, [companyId]);

  useEffect(() => {
    void fetchUrl();
  }, [fetchUrl]);

  return (
    <section
      aria-labelledby="certificate-heading"
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="certificate-heading" className="text-sm font-semibold text-neutral-900">
          {t('heading')}
        </h2>
        {state.kind === 'loaded' && (
          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center gap-1.5 rounded px-2 text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('openInNewTab')}
          </a>
        )}
      </div>

      {state.kind === 'loading' && <Skeleton className="h-96 w-full rounded-lg" />}

      {state.kind === 'loaded' &&
        (isImage(state.url) ? (
          // Signed short-lived R2 URL: next/image would proxy and cache a URL
          // that is deliberately about to die.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.url}
            alt={t('imageAlt')}
            className="max-h-[36rem] w-full rounded-lg border border-neutral-100 object-contain"
          />
        ) : (
          <iframe
            src={state.url}
            title={t('iframeTitle')}
            className="h-96 w-full rounded-lg border border-neutral-100"
          />
        ))}

      {state.kind === 'none' && (
        <div role="status" className="flex items-start gap-3 rounded-lg bg-warning-bg p-4">
          <FileQuestion className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-warning-fg">{t('noneTitle')}</p>
            <p className="mt-1 text-sm text-warning-fg/90">{t('noneBody')}</p>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg bg-neutral-50 p-4">
          <p className="text-sm text-neutral-700">{t('expiredOrFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void fetchUrl()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('refreshLink')}
          </Button>
        </div>
      )}
    </section>
  );
}

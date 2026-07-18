'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, Loader2 } from 'lucide-react';
import { getDocumentUrl } from '@/lib/api/billing';
import { ApiRequestError } from '@/lib/api/client';
import { UpgradePrompt } from './UpgradePrompt';
import type { components } from '@skillindiaconnect/shared-types';

type DocumentType = components['schemas']['DocumentType'];

type ViewState = 'idle' | 'loading' | 'upsell' | 'unavailable' | 'retry';

interface DocumentViewButtonProps {
  candidateId: string;
  documentType: DocumentType;
  uploaded: boolean;
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  PASSPORT: 'passport',
  EXPERIENCE_CERT: 'experience certificate',
  EDUCATIONAL_CERT: 'educational certificate',
};

export function DocumentViewButton({
  candidateId,
  documentType,
  uploaded,
}: DocumentViewButtonProps) {
  const t = useTranslations('billing.manage');
  const [viewState, setViewState] = useState<ViewState>('idle');
  const containerRef = useRef<HTMLDivElement>(null);

  if (!uploaded) return null;

  const handleClick = async () => {
    if (viewState === 'loading') return;
    setViewState('loading');
    try {
      const { url } = await getDocumentUrl(candidateId, documentType);
      window.open(url, '_blank', 'noopener,noreferrer');
      setViewState('idle');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const code = err.error.code;
        if (code === 'PLAN_UPGRADE_REQUIRED') {
          setViewState('upsell');
        } else if (err.error.status === 404) {
          setViewState('unavailable');
        } else if (err.error.status === 403) {
          // Stale signed URL expired on the storage side — distinct from plan gate.
          setViewState('retry');
        } else {
          setViewState('unavailable');
        }
      } else {
        setViewState('unavailable');
      }
    }
  };

  const docLabel = DOC_TYPE_LABELS[documentType] ?? documentType;

  return (
    <div ref={containerRef} className="relative">
      {viewState === 'unavailable' ? (
        <span className="inline-flex min-h-[44px] items-center text-xs text-neutral-400">
          {t('docUnavailable')}
        </span>
      ) : viewState === 'retry' ? (
        <button
          type="button"
          onClick={() => setViewState('idle')}
          className="inline-flex min-h-[44px] items-center gap-1 rounded text-xs font-medium text-neutral-500 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('docExpiredRetry')}
        </button>
      ) : (
        <button
          type="button"
          onClick={viewState === 'upsell' ? () => setViewState('idle') : handleClick}
          disabled={viewState === 'loading'}
          aria-label={
            viewState === 'loading' ? t('viewDocLoading') : t('viewDocLabel', { doc: docLabel })
          }
          className="inline-flex min-h-[44px] items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {viewState === 'loading' ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5" aria-hidden="true" />
          )}
          {viewState === 'loading' ? t('viewDocLoading') : t('viewDoc')}
        </button>
      )}

      {viewState === 'upsell' && (
        <div className="absolute end-0 top-full z-50 w-64">
          <UpgradePrompt onDismiss={() => setViewState('idle')} />
        </div>
      )}
    </div>
  );
}

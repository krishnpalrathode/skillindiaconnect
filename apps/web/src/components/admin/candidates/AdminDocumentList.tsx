'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { getCandidateDocumentUrl, type AdminCandidateDetail } from '@/lib/api/admin-candidates';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type RowState = 'idle' | 'loading' | 'error';

/**
 * The AUDITED document view. The signed URL is minted per click — every
 * issuance writes a `document.viewed` audit row naming this admin, so nothing
 * is fetched eagerly. The URL is short-lived by design (~5 min): a failed open
 * gets a "refresh link" affordance (the S6a-F2 certificate-viewer pattern),
 * not a scary error.
 *
 * "View" is gated on candidates.view_documents — a SEPARATE, higher grant than
 * candidates.view: seeing a card and opening a passport are different acts.
 */
export function AdminDocumentList({ detail }: { detail: AdminCandidateDetail }) {
  const t = useTranslations('admin.candidates.documents');
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const purged = Boolean(detail.purgedAt);

  async function openDocument(type: string) {
    setRowState((s) => ({ ...s, [type]: 'loading' }));
    try {
      const grant = await getCandidateDocumentUrl(detail.id, type as never);
      // New tab, no opener handle — the signed URL page must not script us.
      window.open(grant.url, '_blank', 'noopener,noreferrer');
      setRowState((s) => ({ ...s, [type]: 'idle' }));
    } catch {
      // Expired grant, revoked permission, network — the remedy is the same:
      // mint a fresh link.
      setRowState((s) => ({ ...s, [type]: 'error' }));
    }
  }

  const documents = detail.documents ?? [];

  return (
    <section
      aria-labelledby="admin-documents-heading"
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-documents-heading" className="text-sm font-semibold text-neutral-900">
          {t('heading')}
        </h2>
        {/* Stated once, factually: accountability, not a scare banner. */}
        <p role="note" className="text-xs text-neutral-600">
          {t('viewsLogged')}
        </p>
      </div>

      {documents.length === 0 && (
        <p role="status" className="py-4 text-sm text-neutral-600">
          {purged ? t('emptyPurged') : t('emptyNone')}
        </p>
      )}

      {documents.length > 0 && (
        <ul className="flex flex-col divide-y divide-neutral-100">
          {documents.map((doc) => {
            const state = rowState[doc.type] ?? 'idle';
            return (
              <li
                key={doc.type}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-neutral-900">
                    {t(`type.${doc.type}`)}
                  </span>
                  {/* Rendered as the API states it — validity, not a computed date. */}
                  {doc.passportValid !== undefined && (
                    <Badge variant={doc.passportValid ? 'success' : 'error'}>
                      {doc.passportValid ? t('passportValid') : t('passportExpired')}
                    </Badge>
                  )}
                </div>

                <PermissionGate permission="candidates.view_documents">
                  {state === 'error' ? (
                    <Button variant="outline" size="sm" onClick={() => void openDocument(doc.type)}>
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {t('refreshLink')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state === 'loading'}
                      onClick={() => void openDocument(doc.type)}
                      aria-label={t('viewAria', { type: t(`type.${doc.type}`) })}
                    >
                      {state === 'loading' ? (
                        <Spinner size={14} label="" />
                      ) : (
                        <ExternalLink className="size-4" aria-hidden="true" />
                      )}
                      {t('view')}
                    </Button>
                  )}
                </PermissionGate>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

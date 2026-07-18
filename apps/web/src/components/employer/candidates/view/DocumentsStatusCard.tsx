'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Check, X, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DocumentViewButton } from '@/components/billing/DocumentViewButton';
import type { components } from '@skillindiaconnect/shared-types';

type CandidateDocumentStatus = components['schemas']['CandidateDocumentStatus'];
type DocumentType = components['schemas']['DocumentType'];

interface DocumentsStatusCardProps {
  candidateId: string;
  documentsStatus: CandidateDocumentStatus[];
}

// Known mandatory document types, rendered in a stable order so a missing type
// still shows an explicit ✗ rather than silently disappearing.
const KNOWN_TYPES: DocumentType[] = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'];

/**
 * Document STATUS only — status badges, nothing clickable.
 *
 * There is no key, URL, or content in the payload and nothing to open or
 * download here (signed-URL access is S5, Pro-gated). Passport additionally
 * shows Valid/Expired from `passportValid`. Every element is a plain span/badge;
 * no row is focusable or interactive.
 */
export function DocumentsStatusCard({ candidateId, documentsStatus }: DocumentsStatusCardProps) {
  const t = useTranslations('employer.candidates.view.documents');

  const byType = new Map(documentsStatus.map((d) => [d.type, d]));

  return (
    <section
      aria-labelledby="candidate-documents-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="candidate-documents-heading"
        className="mb-4 text-base font-semibold text-neutral-900"
      >
        {t('title')}
      </h2>

      <ul className="flex flex-col divide-y divide-neutral-100">
        {KNOWN_TYPES.map((type) => {
          const status = byType.get(type);
          const uploaded = status?.uploaded ?? false;
          return (
            <li key={type} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-neutral-700">
                <FileText className="size-4 text-neutral-400" aria-hidden="true" />
                {t(`type.${type}`)}
              </span>

              <span className="flex items-center gap-3 flex-wrap">
                {type === 'PASSPORT' && uploaded && (
                  <Badge variant={status?.passportValid ? 'success' : 'error'}>
                    {status?.passportValid ? t('passportValid') : t('passportExpired')}
                  </Badge>
                )}
                {uploaded ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success-fg">
                    <Check className="size-3.5" aria-hidden="true" />
                    {t('uploaded')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-400">
                    <X className="size-3.5" aria-hidden="true" />
                    {t('notUploaded')}
                  </span>
                )}
                <DocumentViewButton
                  candidateId={candidateId}
                  documentType={type}
                  uploaded={uploaded}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

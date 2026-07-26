'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CertificateUpload } from '@/components/employer/CertificateUpload';
import type { components } from '@skillindiaconnect/shared-types';

type Company = components['schemas']['Company'];

interface CompanyDocumentsSectionProps {
  company: Company;
  /** Called after cert re-upload confirm succeeds so the parent can refetch the profile. */
  onRefetch: () => void;
}

/**
 * Company documents section.
 *
 * Shows the registration certificate status (Verified if APPROVED, else Pending)
 * and a re-upload control. Does NOT display cert content or signed URLs —
 * admins review uploaded files. Status is inferred from company.status.
 *
 * Re-upload uses confirmEnabled=true to run the full presign→PUT→confirm chain.
 * After a successful confirm, onRefetch triggers the parent to re-fetch the
 * full employer profile so the status badge updates.
 */
export function CompanyDocumentsSection({ company, onRefetch }: CompanyDocumentsSectionProps) {
  const t = useTranslations('employer.profile.documents');
  const isApproved = company.status === 'APPROVED';

  return (
    <section
      aria-label={t('sectionTitle')}
      className="rounded-[18px] border border-neutral-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
    >
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="text-base font-semibold text-neutral-900">{t('sectionTitle')}</h2>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Registration certificate status */}
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          {isApproved ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-fg" aria-hidden="true" />
          ) : (
            <Clock className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-neutral-900">{t('certLabel')}</span>
              {isApproved ? (
                <Badge variant="success">{t('certVerified')}</Badge>
              ) : (
                <Badge variant="warning">{t('certPending')}</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-neutral-600">
              {isApproved ? t('verifiedNote') : t('pendingReviewNote')}
            </p>
          </div>
        </div>

        {/* Re-upload control — confirmEnabled fires confirm and then onKey is called */}
        <div>
          <p className="mb-2 text-xs text-neutral-600">{t('reuploadHint')}</p>
          <CertificateUpload confirmEnabled onKey={onRefetch} />
        </div>
      </div>
    </section>
  );
}

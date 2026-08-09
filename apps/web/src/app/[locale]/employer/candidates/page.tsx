'use client';

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEmployer } from '@/lib/employer/employer-context';
import { parseCandidateFilters } from '@/lib/employer/candidateFilters';
import { CandidateFilters } from '@/components/employer/candidates/CandidateFilters';
import { CandidateBrowseList } from '@/components/employer/candidates/CandidateBrowseList';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

/**
 * Screen — Candidate browse (S3).
 *
 * Approval-gated like the rest of the employer shell: an unapproved company
 * sees the F0-style gate (the browse endpoint would 403 anyway). Filters are
 * URL-synced so the filtered view is shareable and survives refresh.
 */
export default function CandidatesPage() {
  const t = useTranslations('employer.candidates');
  const { company, isLoading } = useEmployer();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseCandidateFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  // Loading handled by the employer shell layout
  if (isLoading) return null;

  // Approval gate — non-approved employers are blocked (mirrors the shell nav gate)
  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 pt-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircle className="size-7 text-warning-fg" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">{t('approvalGate.title')}</h1>
        <p className="text-sm text-neutral-600">{t('approvalGate.body')}</p>
        <Button variant="outline" onClick={() => router.push(`/${locale}/employer/dashboard`)}>
          {t('approvalGate.backToDashboard')}
        </Button>
      </div>
    );
  }

  return (
    // Same shell as every other employer tab. This was a bare `max-w-6xl` with no
    // `mx-auto`, so the content hugged the left edge on wide screens instead of
    // sitting where Dashboard and My Jobs put it.
    <div className={EMPLOYER_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr] items-start">
        <aside
          aria-label={t('filters.panelLabel')}
          className="rounded-xl border border-neutral-200 bg-white p-4 lg:sticky lg:top-6"
        >
          <CandidateFilters filters={filters} locale={locale} />
        </aside>

        <div className="min-w-0">
          <CandidateBrowseList filters={filters} />
        </div>
      </div>
    </div>
  );
}

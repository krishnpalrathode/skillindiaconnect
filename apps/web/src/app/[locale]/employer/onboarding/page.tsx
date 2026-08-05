'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useEmployer } from '@/lib/employer/employer-context';
import { CompanyOnboardingForm } from '@/components/employer/CompanyOnboardingForm';

/**
 * Screen 14 — Employer Onboarding / Resubmit
 *
 * Renders inside the F0 employer shell (layout.tsx) which handles auth guard,
 * company-state banner, sidebar/header/plan widget.
 *
 * Mode detection (stated per spec requirement):
 *   company === null  → initial registration (POST /employers/register)
 *   company !== null  → resubmit (PATCH /employers/me/company, REJECTED→PENDING)
 *
 * The F0 shell handles null company gracefully (EmployerProvider treats 404 as
 * null company, not an error). The REJECTED banner in the shell links here for
 * the resubmit flow.
 */
export default function EmployerOnboardingPage() {
  const t = useTranslations('employer.onboarding');
  const { company, isLoading } = useEmployer();

  const isResubmit = !isLoading && company !== null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900">
          {isResubmit ? t('resubmitPageTitle') : t('pageTitle')}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          {isResubmit ? t('resubmitPageSubtitle') : t('pageSubtitle')}
        </p>
      </div>

      {/* Pass company to form only when loaded — avoids flash of empty pre-fill.
          White card surface matches the other employer pages (dashboard, profile). */}
      {!isLoading && (
        <div className="rounded-2xl border border-neutral-200/70 bg-white p-6 shadow-sm sm:p-8">
          <CompanyOnboardingForm company={company} />
        </div>
      )}
    </div>
  );
}

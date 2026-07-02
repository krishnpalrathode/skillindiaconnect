'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JobForm } from '@/components/employer/jobform/JobForm';
import { JobLivePreview } from '@/components/employer/jobform/JobLivePreview';
import { useEmployer } from '@/lib/employer/employer-context';
import { DEFAULT_FORM_VALUES, type JobFormValues } from '@/lib/jobs/jobFormState';

export default function PostJobPage() {
  const t = useTranslations('jobform');
  const { company, isLoading } = useEmployer();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const router = useRouter();

  const [previewValues, setPreviewValues] = useState<JobFormValues>(DEFAULT_FORM_VALUES);

  // Loading handled by the employer shell layout
  if (isLoading) return null;

  // Approval gate — non-approved employers are blocked
  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="max-w-lg mx-auto pt-8 text-center flex flex-col items-center gap-4">
        <div className="size-14 rounded-full bg-warning-bg flex items-center justify-center">
          <AlertCircle className="size-7 text-warning-fg" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">{t('approvalGate.title')}</h1>
        <p className="text-sm text-neutral-500">{t('approvalGate.body')}</p>
        <Button variant="outline" onClick={() => router.push(`/${locale}/employer/dashboard`)}>
          {t('approvalGate.backToDashboard')}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t('createPage.title')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('createPage.subtitle')}</p>
      </div>

      {/* Two-column layout: form (left) + live preview (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8 items-start">
        <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <JobForm onValuesChange={setPreviewValues} />
        </div>

        <aside aria-label={t('preview.panelLabel')}>
          <JobLivePreview values={previewValues} companyName={company.name} locale={locale} />
        </aside>
      </div>
    </div>
  );
}

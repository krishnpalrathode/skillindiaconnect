'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { JobForm } from '@/components/employer/jobform/JobForm';
import { JobLivePreview } from '@/components/employer/jobform/JobLivePreview';
import { useEmployer } from '@/lib/employer/employer-context';
import { type Job } from '@/lib/api/jobs-employer';
import { jobToFormValues, type JobFormValues } from '@/lib/jobs/jobFormState';
import { apiFetch } from '@/lib/api/client';

export default function EditJobPage() {
  const t = useTranslations('jobform');
  const { company } = useEmployer();
  const params = useParams<{ locale: string; id: string }>();
  const locale = params?.locale ?? 'en';
  const jobId = params?.id;
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [previewValues, setPreviewValues] = useState<JobFormValues | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setIsLoading(true);
    apiFetch<Job>(`/jobs/${encodeURIComponent(jobId)}`)
      .then((j) => {
        setJob(j);
        setPreviewValues(jobToFormValues(j));
      })
      .catch(() => setFetchError(t('editPage.loadError')))
      .finally(() => setIsLoading(false));
  }, [jobId, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size={28} label={t('editPage.loading')} />
      </div>
    );
  }

  if (fetchError || !job) {
    return (
      <div className="max-w-lg mx-auto pt-8 text-center flex flex-col items-center gap-4">
        <p className="text-sm text-error-fg">{fetchError ?? t('editPage.notFound')}</p>
        <Button variant="outline" onClick={() => router.back()}>
          {t('editPage.back')}
        </Button>
      </div>
    );
  }

  if (job.status === 'ARCHIVED') {
    return (
      <div className="max-w-lg mx-auto pt-8 text-center flex flex-col items-center gap-4">
        <p className="text-sm text-neutral-500">{t('editPage.archivedNotice')}</p>
        <Button variant="outline" onClick={() => router.push(`/${locale}/employer/jobs`)}>
          {t('editPage.backToJobs')}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t('editPage.title')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('editPage.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8 items-start">
        <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <JobForm job={job} onValuesChange={setPreviewValues} />
        </div>

        {previewValues && company && (
          <aside aria-label={t('preview.panelLabel')}>
            <JobLivePreview values={previewValues} companyName={company.name} locale={locale} />
          </aside>
        )}
      </div>
    </div>
  );
}

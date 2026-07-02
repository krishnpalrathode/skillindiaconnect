'use client';

import React, { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { BenefitsSection } from './BenefitsSection';
import { CompensationSection } from './CompensationSection';
import { WorkConditionsSection } from './WorkConditionsSection';
import { RichTextField } from './RichTextField';
import { RequirementsField } from './RequirementsField';
import { PublishErrorHandler } from './PublishErrorHandler';
import {
  DEFAULT_FORM_VALUES,
  validateJobForm,
  formToPayload,
  jobToFormValues,
  getCurrenciesForMarket,
  type JobFormValues,
} from '@/lib/jobs/jobFormState';
import { createJob, updateJob, publishJob, type Job } from '@/lib/api/jobs-employer';
import { ApiRequestError } from '@/lib/api/client';

interface JobFormProps {
  /** Existing job to edit. null/undefined = create mode. */
  job?: Job | null;
  /** Callback for the live preview — called on every value change */
  onValuesChange?: (values: JobFormValues) => void;
}

export function JobForm({ job, onValuesChange }: JobFormProps) {
  const t = useTranslations('jobform');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const isEdit = !!job;

  const [values, setValues] = useState<JobFormValues>(
    job ? jobToFormValues(job) : DEFAULT_FORM_VALUES,
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateJobForm>>({});
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishStatus, setPublishStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [publishError, setPublishError] = useState<import('@/lib/api/client').ApiError | null>(
    null,
  );
  const [savedJobId, setSavedJobId] = useState<string | null>(job?.id ?? null);

  const patch = useCallback(
    (partial: Partial<JobFormValues>) => {
      setValues((prev) => {
        const next = { ...prev, ...partial } as JobFormValues;
        // When market changes, reset currency to first valid option
        if (partial.market && partial.market !== prev.market) {
          const currencies = getCurrenciesForMarket(partial.market);
          next.salaryCurrency = currencies[0]!;
        }
        onValuesChange?.(next);
        return next;
      });
    },
    [onValuesChange],
  );

  const handleSaveDraft = async () => {
    const errs = validateJobForm(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setDraftStatus('saving');
    setPublishError(null);
    try {
      const payload = formToPayload(values);
      let saved: Job;
      if (savedJobId) {
        saved = await updateJob(savedJobId, payload);
      } else {
        saved = await createJob(payload);
        setSavedJobId(saved.id);
      }
      setDraftStatus('saved');
      setTimeout(() => setDraftStatus('idle'), 3000);
      return saved;
    } catch {
      setDraftStatus('error');
    }
  };

  const handlePublish = async () => {
    const errs = validateJobForm(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setPublishStatus('saving');
    setPublishError(null);
    try {
      const payload = formToPayload(values);
      let jobId = savedJobId;
      if (jobId) {
        await updateJob(jobId, payload);
      } else {
        const created = await createJob(payload);
        jobId = created.id;
        setSavedJobId(jobId);
      }
      await publishJob(jobId!);
      router.push(`/${locale}/employer/jobs?published=1`);
    } catch (err) {
      setPublishStatus('error');
      if (err instanceof ApiRequestError) {
        setPublishError(err.error);
      } else {
        setPublishError({
          code: 'UNKNOWN_ERROR',
          status: 500,
          title: 'Error',
          detail: 'Something went wrong. Please try again.',
        });
      }
    }
  };

  const marketOptions: Array<{ value: JobFormValues['market']; label: string }> = [
    { value: 'GULF', label: t('basic.marketGulf') },
    { value: 'LOCAL', label: t('basic.marketLocal') },
  ];

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      noValidate
      className="flex flex-col gap-8"
      aria-label={isEdit ? t('editFormLabel') : t('createFormLabel')}
    >
      {/* ── 1. Basic Info ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="basic-heading" className="flex flex-col gap-4">
        <div>
          <h3 id="basic-heading" className="text-base font-semibold text-neutral-900">
            {t('basic.heading')}
          </h3>
          <p className="mt-0.5 text-sm text-neutral-500">{t('basic.subtitle')}</p>
        </div>

        <Field id="job-title" label={t('basic.titleLabel')} required error={errors.title}>
          <Input
            id="job-title"
            type="text"
            value={values.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={t('basic.titlePlaceholder')}
            maxLength={200}
            hasError={!!errors.title}
            aria-required
          />
        </Field>

        <Field id="job-market" label={t('basic.marketLabel')} required>
          <div
            role="radiogroup"
            aria-labelledby="job-market-label"
            className="flex gap-3 flex-wrap"
          >
            {marketOptions.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer transition-colors text-sm font-medium min-h-[44px] ${
                  values.market === opt.value
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-neutral-200 text-neutral-700 hover:border-primary-300 hover:bg-primary-50/50'
                }`}
              >
                <input
                  type="radio"
                  name="job-market"
                  value={opt.value}
                  checked={values.market === opt.value}
                  onChange={() => patch({ market: opt.value })}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>

        <Field id="job-location" label={t('basic.locationLabel')} required error={errors.location}>
          <Input
            id="job-location"
            type="text"
            value={values.location}
            onChange={(e) => patch({ location: e.target.value })}
            placeholder={t('basic.locationPlaceholder')}
            maxLength={200}
            hasError={!!errors.location}
            aria-required
          />
        </Field>
      </section>

      {/* ── 2. Job Description ────────────────────────────────────────────────── */}
      <section aria-labelledby="desc-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="desc-heading" className="text-base font-semibold text-neutral-900">
            {t('description.heading')}
          </h3>
          <p className="mt-0.5 text-sm text-neutral-500">{t('description.subtitle')}</p>
        </div>
        <RichTextField
          id="job-description"
          value={values.description}
          onChange={(v) => patch({ description: v })}
          error={errors.description}
        />
      </section>

      {/* ── 3. Compensation ───────────────────────────────────────────────────── */}
      <CompensationSection
        values={values}
        errors={errors}
        onChange={(p) => patch(p as Partial<JobFormValues>)}
      />

      {/* ── 4. Benefits ───────────────────────────────────────────────────────── */}
      <BenefitsSection values={values} onChange={(p) => patch(p as Partial<JobFormValues>)} />

      {/* ── 5. Requirements ───────────────────────────────────────────────────── */}
      <section aria-labelledby="req-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="req-heading" className="text-base font-semibold text-neutral-900">
            {t('requirements.heading')}
          </h3>
          <p className="mt-0.5 text-sm text-neutral-500">{t('requirements.subtitle')}</p>
        </div>
        <RequirementsField
          value={values.requirements}
          onChange={(items) => patch({ requirements: items })}
          error={errors.requirements}
        />
      </section>

      {/* ── 6. Work Conditions ────────────────────────────────────────────────── */}
      <WorkConditionsSection
        values={values}
        errors={errors}
        onChange={(p) => patch(p as Partial<JobFormValues>)}
      />

      {/* ── Publish error banner ──────────────────────────────────────────────── */}
      {publishError && (
        <PublishErrorHandler error={publishError} onDismiss={() => setPublishError(null)} />
      )}

      {/* ── Actions ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-neutral-100">
        <Button
          type="button"
          variant="outline"
          onClick={handleSaveDraft}
          disabled={draftStatus === 'saving' || publishStatus === 'saving'}
          className="min-h-[44px]"
        >
          {draftStatus === 'saving' ? (
            <>
              <Spinner size={16} label="" />
              {t('actions.saving')}
            </>
          ) : draftStatus === 'saved' ? (
            t('actions.saved')
          ) : (
            t('actions.saveDraft')
          )}
        </Button>

        <Button
          type="button"
          onClick={handlePublish}
          disabled={draftStatus === 'saving' || publishStatus === 'saving'}
          className="min-h-[44px]"
        >
          {publishStatus === 'saving' ? (
            <>
              <Spinner size={16} label="" />
              {t('actions.publishing')}
            </>
          ) : (
            t('actions.publish')
          )}
        </Button>

        {draftStatus === 'error' && (
          <p role="alert" className="w-full text-xs text-error-fg font-medium">
            {t('actions.draftError')}
          </p>
        )}
      </div>
    </form>
  );
}

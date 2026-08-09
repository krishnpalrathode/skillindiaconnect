'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { BenefitsSection } from './BenefitsSection';
import { CompensationSection } from './CompensationSection';
import { WorkConditionsSection } from './WorkConditionsSection';
import { RichTextField } from './RichTextField';
import { RequirementsField } from './RequirementsField';
import { PublishErrorHandler } from './PublishErrorHandler';
import { countriesForMarket } from '@/lib/countries';
import {
  DEFAULT_FORM_VALUES,
  validateJobForm,
  formToPayload,
  jobToFormValues,
  getCurrenciesForMarket,
  type JobFormValues,
} from '@/lib/jobs/jobFormState';
import {
  createJob,
  updateJob,
  publishJob,
  getJobCategories,
  type Job,
  type JobCategory,
} from '@/lib/api/jobs-employer';
import { ApiRequestError } from '@/lib/api/client';

interface JobFormProps {
  /** Existing job to edit. null/undefined = create mode. */
  job?: Job | null;
  /** Callback for the live preview — called on every value change */
  onValuesChange?: (values: JobFormValues) => void;
}

export function JobForm({ job, onValuesChange }: JobFormProps) {
  const t = useTranslations('jobform');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();
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
  const [categories, setCategories] = useState<JobCategory[]>([]);

  useEffect(() => {
    getJobCategories()
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  const patch = useCallback(
    (partial: Partial<JobFormValues>) => {
      setValues((prev) => {
        const next = { ...prev, ...partial } as JobFormValues;
        // When market changes, reset currency to first valid option and the
        // country to one valid for that market: India is auto-selected for LOCAL
        // (its only option); GULF requires an explicit pick.
        if (partial.market && partial.market !== prev.market) {
          const currencies = getCurrenciesForMarket(partial.market);
          next.salaryCurrency = currencies[0]!;
          next.country = partial.market === 'LOCAL' ? 'India' : '';
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
      const isUpdate = Boolean(savedJobId);
      let saved: Job;
      if (savedJobId) {
        saved = await updateJob(savedJobId, payload);
      } else {
        saved = await createJob(payload);
        setSavedJobId(saved.id);
      }
      setDraftStatus('saved');
      setTimeout(() => setDraftStatus('idle'), 3000);
      // 'created' vs 'updated' comes from whether the draft already had an id
      // BEFORE this save — savedJobId is set above for the create path.
      showToast({ message: tToast(isUpdate ? 'jobUpdated' : 'jobCreated') });
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
      className="flex flex-col gap-9"
      aria-label={isEdit ? t('editFormLabel') : t('createFormLabel')}
    >
      {/* ── 1. Basic Info ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="basic-heading" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
          >
            1
          </span>
          <div>
            <h3 id="basic-heading" className="text-base font-bold text-neutral-900">
              {t('basic.heading')}
            </h3>
            <p className="mt-0.5 text-sm text-neutral-600">{t('basic.subtitle')}</p>
          </div>
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
                className={`flex items-center gap-2 rounded-xl border-2 px-5 py-2.5 cursor-pointer transition-all text-sm font-semibold min-h-[44px] ${
                  values.market === opt.value
                    ? 'border-[#0F3D91] bg-[#E8F0FE] text-[#0F3D91] shadow-sm'
                    : 'border-neutral-200 text-neutral-700 hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]/40'
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

        <Field id="job-country" label={t('basic.countryLabel')} required error={errors.country}>
          <select
            id="job-country"
            value={values.country}
            onChange={(e) => patch({ country: e.target.value })}
            aria-required
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
          >
            <option value="" disabled>
              {t('basic.countryPlaceholder')}
            </option>
            {countriesForMarket(values.market).map((c) => (
              <option key={c.key} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="job-category" label="Job category" required error={errors.categoryId}>
          <select
            id="job-category"
            value={values.categoryId}
            onChange={(e) => patch({ categoryId: e.target.value })}
            aria-required
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
          >
            <option value="" disabled>
              {categories.length === 0 ? 'Loading categories…' : 'Select a category'}
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {locale === 'hi'
                  ? (cat.nameHi ?? cat.nameEn)
                  : locale === 'ar'
                    ? (cat.nameAr ?? cat.nameEn)
                    : cat.nameEn}
              </option>
            ))}
          </select>
        </Field>

        <Field id="job-employment-type" label="Employment type" required>
          <select
            id="job-employment-type"
            value={values.employmentType}
            onChange={(e) =>
              patch({ employmentType: e.target.value as JobFormValues['employmentType'] })
            }
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
          >
            <option value="FULL_TIME">Full-time</option>
            <option value="PART_TIME">Part-time</option>
            <option value="CONTRACT">Contract</option>
          </select>
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
      <section aria-labelledby="desc-heading" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
          >
            2
          </span>
          <div>
            <h3 id="desc-heading" className="text-base font-bold text-neutral-900">
              {t('description.heading')}
            </h3>
            <p className="mt-0.5 text-sm text-neutral-600">{t('description.subtitle')}</p>
          </div>
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
      <section aria-labelledby="req-heading" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
          >
            5
          </span>
          <div>
            <h3 id="req-heading" className="text-base font-bold text-neutral-900">
              {t('requirements.heading')}
            </h3>
            <p className="mt-0.5 text-sm text-neutral-600">{t('requirements.subtitle')}</p>
          </div>
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

      {/* ── Actions — sticky so they stay reachable on this long form ─────────── */}
      <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center gap-3 border-t border-neutral-200/70 bg-white/95 px-6 py-4 backdrop-blur-md sm:rounded-b-2xl">
        <Button
          type="button"
          variant="outline"
          onClick={handleSaveDraft}
          disabled={draftStatus === 'saving' || publishStatus === 'saving'}
          className="min-h-[44px] rounded-xl"
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
          className="min-h-[44px] rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] shadow-md shadow-[#0F3D91]/20 transition-all hover:-translate-y-0.5 hover:shadow-lg"
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

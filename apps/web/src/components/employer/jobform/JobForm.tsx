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
import { TermsAcceptance } from './TermsAcceptance';
import { PublishedNotice } from './PublishedNotice';
import { countriesForMarket } from '@/lib/countries';
import {
  DEFAULT_FORM_VALUES,
  validateJobForm,
  CONTRACT_DURATIONS,
  formToPayload,
  jobToFormValues,
  defaultCurrencyForMarket,
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
  /*
    The just-published job, held only long enough to show the lifetime notice.
    Non-null means "publish succeeded, tell them when it expires" — the redirect
    waits for them to acknowledge, so the message cannot be missed by a
    navigation firing underneath it.
  */
  const [publishedJob, setPublishedJob] = useState<Job | null>(null);
  const [categories, setCategories] = useState<JobCategory[]>([]);
  /**
   * Whether anything has changed since the last successful save.
   *
   * Starts false — an untouched form (a blank create, or an edit the user has
   * only looked at) has nothing to save, and leaving Save enabled invites a
   * pointless round-trip and a duplicate-looking "saved" toast. Any `patch`
   * sets it; a successful save clears it. That is the whole re-enable rule:
   * change something and the button comes back.
   */
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getJobCategories()
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  // The "Other" row is identified by its SLUG, never by its label or position —
  // the label is translated and the list is server-ordered.
  const otherCategoryId = categories.find((c) => c.slug === 'other')?.id;
  const isOtherCategory = !!otherCategoryId && values.categoryId === otherCategoryId;

  const patch = useCallback(
    (partial: Partial<JobFormValues>) => {
      setDirty(true);
      setValues((prev) => {
        const next = { ...prev, ...partial } as JobFormValues;
        // When market changes, reset currency to first valid option and the
        // country to one valid for that market: India is auto-selected for LOCAL
        // (its only option); GULF requires an explicit pick.
        if (partial.market && partial.market !== prev.market) {
          // The market picks the DEFAULT currency, not the available set — the
          // list is now the full enum, so currencies[0] would put every market
          // on INR regardless of where the job actually is.
          next.salaryCurrency = defaultCurrencyForMarket(partial.market);
          next.country = partial.market === 'LOCAL' ? 'India' : '';

          /*
            Worker protections follow the market.

            GULF locks all three ON — the platform refuses to publish an overseas
            posting without them. LOCAL resets them to OFF, deliberately: they
            are opt-IN for a domestic job. Carrying the Gulf defaults across
            would have a local employer publish a job claiming free housing and
            transport purely because they started on the other tab, which is a
            promise to the worker that nobody actually made.
          */
          const gulf = partial.market === 'GULF';
          next.accommodation = gulf;
          next.healthInsurance = gulf;
          next.transportation = gulf;
        }
        onValuesChange?.(next);
        return next;
      });
    },
    [onValuesChange],
  );

  const handleSaveDraft = async () => {
    const errs = validateJobForm(values, otherCategoryId);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setDraftStatus('saving');
    setPublishError(null);
    try {
      const payload = formToPayload(values, otherCategoryId);
      const isUpdate = Boolean(savedJobId);
      let saved: Job;
      if (savedJobId) {
        saved = await updateJob(savedJobId, payload);
      } else {
        saved = await createJob(payload);
        setSavedJobId(saved.id);
      }
      setDraftStatus('saved');
      setDirty(false);
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
    const errs = validateJobForm(values, otherCategoryId);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setPublishStatus('saving');
    setPublishError(null);
    try {
      const payload = formToPayload(values, otherCategoryId);
      let jobId = savedJobId;
      if (jobId) {
        await updateJob(jobId, payload);
      } else {
        const created = await createJob(payload);
        jobId = created.id;
        setSavedJobId(jobId);
      }
      const published = await publishJob(jobId!);
      setPublishStatus('idle');
      setDirty(false);
      setPublishedJob(published);
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

        {/* Only rendered for "Other" — an always-present box that is usually
            irrelevant is what makes a form feel long. Not unmounted-and-
            forgotten either: the draft value survives in form state, so
            switching to a trade and back does not erase what they typed. */}
        {isOtherCategory && (
          <Field
            id="job-category-other"
            label={t('basic.categoryOtherLabel')}
            required
            error={errors.categoryOther}
            hint={t('basic.categoryOtherHint')}
          >
            <Input
              id="job-category-other"
              type="text"
              value={values.categoryOther}
              onChange={(e) => patch({ categoryOther: e.target.value })}
              placeholder={t('basic.categoryOtherPlaceholder')}
              maxLength={80}
              hasError={!!errors.categoryOther}
              aria-required
            />
          </Field>
        )}

        <Field id="job-employment-type" label="Employment type" required>
          <select
            id="job-employment-type"
            value={values.employmentType}
            onChange={(e) => {
              const next = e.target.value as JobFormValues['employmentType'];
              // Moving off Contract drops the duration with it. The server
              // rejects a duration on a non-contract job, so keeping a stale
              // value here would turn a harmless dropdown change into a 400.
              patch(
                next === 'CONTRACT'
                  ? { employmentType: next }
                  : { employmentType: next, contractDuration: '' },
              );
            }}
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
          >
            <option value="FULL_TIME">Full-time</option>
            <option value="PART_TIME">Part-time</option>
            <option value="CONTRACT">Contract</option>
          </select>
        </Field>

        {/*
          Revealed by Contract only. A candidate's first question about a contract
          role is how long it runs, and the band is the honest answer — an exact
          month count would be a number the employer never actually committed to.
        */}
        {values.employmentType === 'CONTRACT' && (
          <Field
            id="job-contract-duration"
            label="Contract duration"
            required
            error={errors.contractDuration}
          >
            <select
              id="job-contract-duration"
              value={values.contractDuration}
              onChange={(e) =>
                patch({
                  contractDuration: e.target.value as JobFormValues['contractDuration'],
                })
              }
              aria-invalid={!!errors.contractDuration}
              aria-required
              className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
            >
              <option value="">Select contract length</option>
              {CONTRACT_DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        )}

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

      {/* ── 7. Terms for this posting ─────────────────────────────────────────── */}
      <TermsAcceptance
        accepted={values.termsAccepted}
        onChange={(next) => patch({ termsAccepted: next })}
        error={errors.termsAccepted}
      />

      {publishedJob && (
        <PublishedNotice
          autoArchiveAt={publishedJob.autoArchiveAt}
          onClose={() => {
            setPublishedJob(null);
            router.push(`/${locale}/employer/jobs?published=1`);
          }}
        />
      )}

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
          // Nothing to save until something changes again. Publish is NOT
          // gated this way — publishing an already-saved, unchanged draft is a
          // legitimate next step, not a re-save.
          disabled={draftStatus === 'saving' || publishStatus === 'saving' || !dirty}
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
          variant="brand"
          type="button"
          onClick={handlePublish}
          disabled={draftStatus === 'saving' || publishStatus === 'saving'}
          className="min-h-[44px] rounded-xl shadow-md shadow-[#0F3D91]/20 transition-all hover:-translate-y-0.5 hover:shadow-lg"
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

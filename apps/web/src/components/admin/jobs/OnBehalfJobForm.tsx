'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Search } from 'lucide-react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { BenefitsSection } from '@/components/employer/jobform/BenefitsSection';
import { CompensationSection } from '@/components/employer/jobform/CompensationSection';
import { TermsAcceptance } from '@/components/employer/jobform/TermsAcceptance';
import { WorkConditionsSection } from '@/components/employer/jobform/WorkConditionsSection';
import { RichTextField } from '@/components/employer/jobform/RichTextField';
import { RequirementsField } from '@/components/employer/jobform/RequirementsField';
import {
  DEFAULT_FORM_VALUES,
  validateJobForm,
  formToPayload,
  getCurrenciesForMarket,
  type JobFormValues,
} from '@/lib/jobs/jobFormState';
import { getJobCategories, type JobCategory } from '@/lib/api/jobs-employer';
import { countriesForMarket } from '@/lib/countries';
import { listEmployers, type Company } from '@/lib/api/admin-employers';
import { createJobOnBehalf, type Job } from '@/lib/api/admin-jobs';
import { ApiRequestError, type ApiError } from '@/lib/api/client';
import { GateFailureExplainer } from './GateFailureExplainer';

/**
 * On-behalf posting (minimal — the designated slip item). REUSE CHOICE: the
 * S2-F4 form SECTIONS and state module are reused wholesale (BenefitsSection,
 * CompensationSection, WorkConditionsSection, RichTextField,
 * RequirementsField, validateJobForm/formToPayload) — they take
 * values/errors/onChange and don't care who submits. Only the SHELL is admin-
 * owned, because the employer JobForm's shell is welded to the employer
 * create→update→publish ladder while on-behalf is one POST with a `publish`
 * flag.
 *
 * Two things hold by construction:
 *  - the worker-protection benefits follow the MARKET, exactly as they do for
 *    an employer (BenefitsSection locks them for a GULF posting and offers them
 *    as opt-in for a LOCAL one) — an admin gets no bypass either way;
 *  - publishing runs the SAME gate ladder against the TARGET employer, so the
 *    same GateFailureExplainer renders the failures. A gate failure leaves an
 *    honest DRAFT behind (stated in the UI). Save-as-draft always works.
 */
export function OnBehalfJobForm() {
  const t = useTranslations('admin.jobs.onBehalf');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  // ── Employer picker ─────────────────────────────────────────────────────────
  const [employerSearch, setEmployerSearch] = useState('');
  const [employerResults, setEmployerResults] = useState<Company[] | null>(null);
  const [employer, setEmployer] = useState<Company | null>(null);
  const [employerError, setEmployerError] = useState<string | null>(null);

  const searchEmployers = useCallback(async (query: string) => {
    setEmployerResults(null);
    try {
      // Approved employers only — a job can only ever publish for one.
      const page = await listEmployers({
        status: 'APPROVED',
        search: query || undefined,
        pageSize: 20,
      });
      setEmployerResults(page.data);
    } catch {
      setEmployerResults([]);
    }
  }, []);

  // Dynamic search: debounce the typed query into the employer lookup. Fires on
  // mount too (empty query → the initial approved-employer list), so no separate
  // load effect is needed and no submit button gates the search.
  useEffect(() => {
    const id = setTimeout(() => void searchEmployers(employerSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [employerSearch, searchEmployers]);

  // ── The job form (S2-F4 state module) ──────────────────────────────────────
  const [values, setValues] = useState<JobFormValues>(DEFAULT_FORM_VALUES);
  const [errors, setErrors] = useState<ReturnType<typeof validateJobForm>>({});
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [gateError, setGateError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ job: Job; published: boolean } | null>(null);
  const [draftAfterFailure, setDraftAfterFailure] = useState(false);

  useEffect(() => {
    getJobCategories()
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  const patch = useCallback((partial: Partial<JobFormValues>) => {
    setValues((prev) => {
      const next = { ...prev, ...partial } as JobFormValues;
      if (partial.market && partial.market !== prev.market) {
        next.salaryCurrency = getCurrenciesForMarket(partial.market)[0]!;
        next.country = partial.market === 'LOCAL' ? 'India' : '';
      }
      return next;
    });
  }, []);

  async function submit(publish: boolean) {
    setGateError(null);
    setDraftAfterFailure(false);
    if (!employer) {
      setEmployerError(t('employerRequired'));
      return;
    }
    const errs = validateJobForm(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(publish ? 'publish' : 'draft');
    try {
      const job = await createJobOnBehalf(
        employer.id,
        formToPayload(values) as unknown as Record<string, unknown>,
        publish,
      );
      setCreated({ job, published: publish });
      showToast({ message: tToast(publish ? 'jobPublished' : 'jobCreated') });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // The gate ladder spoke. The job was still created as a DRAFT (the
        // create half always succeeds) — say so, don't leave the admin
        // guessing where their work went.
        setGateError(err.error);
        setDraftAfterFailure(true);
      } else {
        setGateError({
          code: 'UNKNOWN_ERROR',
          status: 0,
          title: 'Error',
          detail: t('createFailed'),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  if (created) {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-xl border border-success-fg/30 bg-success-bg/40 p-5"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-success-fg">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          {created.published
            ? t('publishedNote', { company: employer?.name ?? '' })
            : t('draftNote', { company: employer?.name ?? '' })}
        </p>
        <Link
          href={`/${locale}/admin/jobs/${created.job.id}`}
          className="text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('viewJob')}
        </Link>
      </div>
    );
  }

  const marketOptions: Array<{ value: JobFormValues['market']; label: string }> = [
    { value: 'GULF', label: t('marketGulf') },
    { value: 'LOCAL', label: t('marketLocal') },
  ];

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="flex flex-col gap-8">
      {/* ── 0. WHO the job is for ─────────────────────────────────────────── */}
      <section aria-labelledby="employer-picker-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="employer-picker-heading" className="text-base font-semibold text-neutral-900">
            {t('employerHeading')}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">{t('employerSubtitle')}</p>
        </div>

        {employer ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
            <p className="text-sm font-medium text-primary-800">{employer.name}</p>
            <Button variant="outline" size="sm" onClick={() => setEmployer(null)}>
              {t('changeEmployer')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative w-72">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-600"
                aria-hidden="true"
              />
              <label htmlFor="employer-search" className="sr-only">
                {t('employerSearchLabel')}
              </label>
              <input
                id="employer-search"
                type="search"
                value={employerSearch}
                onChange={(e) => setEmployerSearch(e.target.value)}
                placeholder={t('employerSearchPlaceholder')}
                className="min-h-[44px] w-full rounded-lg border border-neutral-300 ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              />
            </div>

            {employerResults === null && <Spinner size={18} label={t('employerLoading')} />}
            {employerResults !== null && employerResults.length === 0 && (
              <p role="status" className="text-sm text-neutral-600">
                {t('employerNoResults')}
              </p>
            )}
            {employerResults !== null && employerResults.length > 0 && (
              <ul className="flex max-h-64 flex-col divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                {employerResults.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmployer(c);
                        setEmployerError(null);
                      }}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-primary-50/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    >
                      <span className="font-medium text-neutral-900">{c.name}</span>
                      <span className="text-xs text-neutral-600">{c.location}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {employerError && (
              <p role="alert" className="text-xs font-medium text-error-fg">
                {employerError}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── 1. Basic info (the S2-F4 fields, admin shell) ─────────────────── */}
      <section aria-labelledby="onbehalf-basic-heading" className="flex flex-col gap-4">
        <h2 id="onbehalf-basic-heading" className="text-base font-semibold text-neutral-900">
          {t('basicHeading')}
        </h2>

        <Field id="ob-job-title" label={t('titleLabel')} required error={errors.title}>
          <Input
            id="ob-job-title"
            type="text"
            value={values.title}
            onChange={(e) => patch({ title: e.target.value })}
            maxLength={200}
            hasError={!!errors.title}
            aria-required
          />
        </Field>

        <Field id="ob-job-market" label={t('marketLabel')} required>
          <div role="radiogroup" aria-label={t('marketLabel')} className="flex flex-wrap gap-3">
            {marketOptions.map((opt) => (
              <label
                key={opt.value}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  values.market === opt.value
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-neutral-200 text-neutral-700 hover:border-primary-300'
                }`}
              >
                <input
                  type="radio"
                  name="ob-job-market"
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

        <Field id="ob-job-country" label={t('countryLabel')} required error={errors.country}>
          <select
            id="ob-job-country"
            value={values.country}
            onChange={(e) => patch({ country: e.target.value })}
            aria-required
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="" disabled>
              {t('countryPlaceholder')}
            </option>
            {countriesForMarket(values.market).map((c) => (
              <option key={c.key} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="ob-job-category" label={t('categoryLabel')} required error={errors.categoryId}>
          <select
            id="ob-job-category"
            value={values.categoryId}
            onChange={(e) => patch({ categoryId: e.target.value })}
            aria-required
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="" disabled>
              {categories.length === 0 ? t('categoriesLoading') : t('categoryPlaceholder')}
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nameEn}
              </option>
            ))}
          </select>
        </Field>

        <Field id="ob-job-location" label={t('locationLabel')} required error={errors.location}>
          <Input
            id="ob-job-location"
            type="text"
            value={values.location}
            onChange={(e) => patch({ location: e.target.value })}
            maxLength={200}
            hasError={!!errors.location}
            aria-required
          />
        </Field>

        <RichTextField
          id="ob-job-description"
          value={values.description}
          onChange={(v) => patch({ description: v })}
          error={errors.description}
        />
      </section>

      {/* ── 2-4. The REUSED S2-F4 sections (locked protection benefits incl.) ── */}
      <CompensationSection
        values={values}
        errors={errors}
        onChange={(p) => patch(p as Partial<JobFormValues>)}
      />
      <BenefitsSection values={values} onChange={(p) => patch(p as Partial<JobFormValues>)} />
      <section aria-labelledby="ob-req-heading" className="flex flex-col gap-3">
        <h2 id="ob-req-heading" className="text-base font-semibold text-neutral-900">
          {t('requirementsHeading')}
        </h2>
        <RequirementsField
          value={values.requirements}
          onChange={(items) => patch({ requirements: items })}
          error={errors.requirements}
        />
      </section>
      <WorkConditionsSection
        values={values}
        errors={errors}
        onChange={(p) => patch(p as Partial<JobFormValues>)}
      />

      {/*
        The admin accepts the posting terms too. Posting on an employer's behalf
        does not exempt the posting from them — and an admin-created job with no
        acceptance record would be the one job nobody could answer for.
      */}
      <TermsAcceptance
        accepted={values.termsAccepted}
        onChange={(next) => patch({ termsAccepted: next })}
        error={errors.termsAccepted}
      />

      {/* ── The gate failures — the SAME explainer as the review screen ────── */}
      {gateError && employer && (
        <div className="flex flex-col gap-2">
          <GateFailureExplainer
            error={gateError}
            companyId={employer.id}
            companyName={employer.name}
          />
          {draftAfterFailure && (
            <p role="status" className="text-sm text-neutral-600">
              {t('draftSurvivedFailure')}
            </p>
          )}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 border-t border-neutral-100 pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void submit(false)}
          disabled={busy !== null}
          className="min-h-[44px]"
        >
          {busy === 'draft' && <Spinner size={16} label="" />}
          {t('saveDraft')}
        </Button>
        <Button
          type="button"
          onClick={() => void submit(true)}
          disabled={busy !== null}
          className="min-h-[44px]"
        >
          {busy === 'publish' && <Spinner size={16} label="" />}
          {t('publishNow')}
        </Button>
        {/* No bypass: the same gates as the employer's own publish. */}
        <p className="w-full text-xs text-neutral-600">{t('gatesNote')}</p>
      </div>
    </form>
  );
}

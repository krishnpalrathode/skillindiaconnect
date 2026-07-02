'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { registerCompany, patchCompany } from '@/lib/api/employer';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { CompanyTypeRadio } from './CompanyTypeRadio';
import { CertificateUpload } from './CertificateUpload';

type Company = components['schemas']['Company'];
type CompanyType = components['schemas']['CompanyType'];
type EmployeeRange = components['schemas']['EmployeeRange'];

interface CompanyOnboardingFormProps {
  /**
   * Populated when the employer's company is REJECTED — the form pre-fills and
   * submits via PATCH (resubmit path). Null for initial registration (POST path).
   *
   * Detection: the employer shell loads company via useEmployer(). The onboarding
   * page passes company={company} when company !== null. The form infers:
   *   company === null  → initial registration (POST /employers/register)
   *   company !== null  → resubmit (PATCH /employers/me/company, REJECTED→PENDING)
   */
  company: Company | null;
}

const EMPLOYEE_RANGES: EmployeeRange[] = ['1-10', '11-50', '51-200', '201-500', '500+'];

const INDUSTRY_KEYS = [
  'construction',
  'manufacturing',
  'hospitality',
  'healthcare',
  'retail',
  'logistics',
  'agriculture',
  'it',
  'security',
  'cleaning',
  'other',
] as const;

export function CompanyOnboardingForm({ company }: CompanyOnboardingFormProps) {
  const t = useTranslations('employer.onboarding');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const isResubmit = company !== null;

  // ── Form state ────────────────────────────────────────────────────────────
  const [companyType, setCompanyType] = useState<CompanyType | ''>(company?.type ?? '');
  const [name, setName] = useState(company?.name ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(company?.registrationNumber ?? '');
  const [industryType, setIndustryType] = useState(company?.industryType ?? '');
  const [phone, setPhone] = useState(company?.phone ?? '');
  const [location, setLocation] = useState(company?.location ?? '');
  const [website, setWebsite] = useState(company?.website ?? '');
  const [employeeRange, setEmployeeRange] = useState<EmployeeRange | ''>(
    company?.employeeRange ?? '',
  );
  const [description, setDescription] = useState(company?.description ?? '');
  const [certKey, setCertKey] = useState<string | null>(company?.registrationCertKey ?? null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const certKeyRef = useRef<string | null>(certKey);
  useEffect(() => {
    certKeyRef.current = certKey;
  }, [certKey]);

  const handleCertKey = useCallback((key: string) => {
    setCertKey(key);
    certKeyRef.current = key;
    setErrors((prev) => ({ ...prev, cert: '' }));
  }, []);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!companyType) next.companyType = t('companyTypeRequired');
    if (!name.trim()) next.name = t('nameRequired');
    if (!phone.trim()) next.phone = t('phoneRequired');
    if (!location.trim()) next.location = t('locationRequired');
    if (!employeeRange) next.employeeRange = t('employeeRangeRequired');
    if (!certKeyRef.current) next.cert = t('certRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setSubmitSuccess('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (!isResubmit) {
        await registerCompany({
          name: name.trim(),
          type: companyType as CompanyType,
          phone: phone.trim(),
          location: location.trim(),
          employeeRange: employeeRange as EmployeeRange,
          registrationNumber: registrationNumber.trim() || undefined,
          industryType: industryType || undefined,
          website: website.trim() || undefined,
          description: description.trim() || undefined,
          registrationCertKey: certKeyRef.current ?? undefined,
        });
      } else {
        await patchCompany({
          name: name.trim(),
          type: companyType as CompanyType,
          phone: phone.trim(),
          location: location.trim(),
          employeeRange: employeeRange as EmployeeRange,
          registrationNumber: registrationNumber.trim() || undefined,
          industryType: industryType || undefined,
          website: website.trim() || undefined,
          description: description.trim() || undefined,
          registrationCertKey: certKeyRef.current ?? undefined,
        });
      }
      setSubmitSuccess(t('submitSuccess'));
      setTimeout(() => router.push(`/${locale}/employer/dashboard`), 1500);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'COMPANY_ALREADY_EXISTS' || err.error.status === 409) {
          setSubmitError(t('companyExists'));
        } else if (err.error.status === 422) {
          setSubmitError(t('validationError'));
        } else {
          setSubmitError(t('genericError'));
        }
      } else {
        setSubmitError(t('genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6 max-w-2xl">
      {submitSuccess && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-success-fg font-medium rounded-lg bg-success-bg px-3 py-2"
        >
          {submitSuccess}
        </p>
      )}
      {submitError && (
        <p
          role="alert"
          className="text-sm text-error-fg font-medium rounded-lg bg-error-bg px-3 py-2"
        >
          {submitError}
        </p>
      )}

      {/* Company type radio — load-bearing */}
      <CompanyTypeRadio value={companyType} onChange={setCompanyType} error={errors.companyType} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          id="ob-name"
          label={t('nameLabel')}
          error={errors.name}
          required
          className="sm:col-span-2"
        >
          <Input
            id="ob-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            autoComplete="organization"
            hasError={!!errors.name}
          />
        </Field>

        <Field id="ob-regnum" label={t('registrationNumberLabel')}>
          <Input
            id="ob-regnum"
            type="text"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={t('registrationNumberPlaceholder')}
          />
        </Field>

        <Field id="ob-industry" label={t('industryTypeLabel')}>
          <select
            id="ob-industry"
            value={industryType}
            onChange={(e) => setIndustryType(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{t('industryTypePlaceholder')}</option>
            {INDUSTRY_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`industries.${k}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </Field>

        <Field id="ob-phone" label={t('phoneLabel')} error={errors.phone} required>
          <Input
            id="ob-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('phonePlaceholder')}
            autoComplete="tel"
            hasError={!!errors.phone}
          />
        </Field>

        <Field id="ob-location" label={t('locationLabel')} error={errors.location} required>
          <Input
            id="ob-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('locationPlaceholder')}
            hasError={!!errors.location}
          />
        </Field>

        <Field id="ob-website" label={t('websiteLabel')}>
          <Input
            id="ob-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder={t('websitePlaceholder')}
            autoComplete="url"
          />
        </Field>

        <Field
          id="ob-emprange"
          label={t('employeeRangeLabel')}
          error={errors.employeeRange}
          required
        >
          <select
            id="ob-emprange"
            value={employeeRange}
            onChange={(e) => setEmployeeRange(e.target.value as EmployeeRange)}
            aria-invalid={!!errors.employeeRange}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{t('employeeRangePlaceholder')}</option>
            {EMPLOYEE_RANGES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field id="ob-desc" label={t('descriptionLabel')} className="sm:col-span-2">
          <textarea
            id="ob-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('descriptionPlaceholder')}
            rows={3}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 resize-y min-h-[80px]"
          />
        </Field>
      </div>

      {/* Certificate upload */}
      <CertificateUpload confirmEnabled={isResubmit} onKey={handleCertKey} error={errors.cert} />

      <Button
        type="submit"
        variant="secondary"
        size="md"
        loading={submitting}
        className="w-full sm:w-auto sm:min-w-[200px]"
      >
        {isResubmit ? t('resubmitButton') : t('submitButton')}
      </Button>
    </form>
  );
}

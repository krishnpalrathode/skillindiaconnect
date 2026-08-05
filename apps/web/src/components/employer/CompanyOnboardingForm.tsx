'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { registerCompany, patchCompany } from '@/lib/api/employer';
import { useEmployer } from '@/lib/employer/employer-context';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { COUNTRIES, DEFAULT_COUNTRY, DIAL_CODES, dialCodeForCountry } from '@/lib/countries';
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

/** Mirrors COMPANY_NAME_MAX in the API's register/update DTOs. */
const COMPANY_NAME_MAX = 100;

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
  const { refetch: refetchCompany } = useEmployer();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const isResubmit = company !== null;

  // ── Form state ────────────────────────────────────────────────────────────
  const [companyType, setCompanyType] = useState<CompanyType | ''>(company?.type ?? '');
  const [name, setName] = useState(company?.name ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(company?.registrationNumber ?? '');
  const [industryType, setIndustryType] = useState(company?.industryType ?? '');
  const [phoneCode, setPhoneCode] = useState(company?.phoneCode ?? DEFAULT_COUNTRY.dialCode);
  const [phone, setPhone] = useState(company?.phone ?? '');
  const [country, setCountry] = useState(company?.country ?? '');
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
  // The post-success redirect timer must die with the component — a push()
  // firing after unmount navigates a screen the user already left.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    },
    [],
  );
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

    const trimmedName = name.trim();
    if (!trimmedName) next.name = t('nameRequired');
    else if (trimmedName.length > COMPANY_NAME_MAX) next.name = t('nameTooLong');
    // Blocks a name made only of punctuation/symbols ("---", "@@@") while still
    // allowing punctuation inside a real name ("L&T Ltd."). Unicode-aware so
    // Devanagari and Arabic names pass.
    else if (!/[\p{L}\p{N}]/u.test(trimmedName)) next.name = t('nameNoAlnum');

    if (!phoneCode.trim()) next.phoneCode = t('phoneCodeRequired');
    if (!phone.trim()) next.phone = t('phoneRequired');
    if (!country) next.country = t('countryRequired');
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
          phoneCode: phoneCode.trim(),
          phone: phone.trim(),
          country,
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
          phoneCode: phoneCode.trim(),
          phone: phone.trim(),
          country,
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
      redirectTimerRef.current = setTimeout(() => {
        // The shell's banner + gating render from EmployerProvider — without a
        // refetch, a resubmitted employer keeps seeing their STALE rejection
        // banner (old reason included) until a hard reload (caught by the S6
        // happy-path pass, B5). Refetched HERE, at the redirect moment, not on
        // success: the provider's loading flip unmounts this form, which would
        // eat the success message and this very timer.
        refetchCompany();
        router.push(`/${locale}/employer/dashboard`);
      }, 1500);
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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
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
            maxLength={COMPANY_NAME_MAX}
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

        {/* Dial code + number share a row; the code is its own column server-side. */}
        <div className="flex gap-2">
          <div className="w-28 shrink-0">
            <Field id="ob-phonecode" label={t('phoneCodeLabel')} error={errors.phoneCode} required>
              <select
                id="ob-phonecode"
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)}
                aria-invalid={!!errors.phoneCode}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {DIAL_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="min-w-0 flex-1">
            <Field id="ob-phone" label={t('phoneLabel')} error={errors.phone} required>
              <Input
                id="ob-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
                autoComplete="tel-national"
                hasError={!!errors.phone}
              />
            </Field>
          </div>
        </div>

        <Field id="ob-country" label={t('countryLabel')} error={errors.country} required>
          <select
            id="ob-country"
            value={country}
            onChange={(e) => {
              const next = e.target.value;
              setCountry(next);
              // Keep the dial code in step with the country the employer picked;
              // they can still override it for a company with a foreign line.
              const code = dialCodeForCountry(next);
              if (code) setPhoneCode(code);
            }}
            aria-invalid={!!errors.country}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{t('countryPlaceholder')}</option>
            {COUNTRIES.map((c) => (
              <option key={c.key} value={c.name}>
                {t(`countries.${c.key}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
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

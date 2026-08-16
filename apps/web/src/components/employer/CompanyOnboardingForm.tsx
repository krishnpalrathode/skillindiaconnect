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
import { COUNTRIES, DEFAULT_COUNTRY, dialCodeForCountry } from '@/lib/countries';
import { optionForDialCode } from '@/lib/dial-codes';
import { CountryCodeSelect } from '@/components/common/CountryCodeSelect';
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

/** The one option that asks the employer to type their own industry. */
const INDUSTRY_OTHER = 'other';

/** Mirrors `@MaxLength(100)` on `industryType` in the register/update DTOs. */
const INDUSTRY_TYPE_MAX = 100;

/**
 * Mirrors FOUNDED_YEAR_MIN in the API's founded-year validator. A floor that
 * rejects the realistic typo (`19`, `202`) rather than a guess at the oldest
 * company in the world. The ceiling is THIS year, read at render time so the
 * form does not start rejecting valid years after a New Year rollover.
 */
const FOUNDED_YEAR_MIN = 1800;

/**
 * Split a stored `industryType` back into the two controls that produced it.
 *
 * `Company.industryType` is a free-form `String(100)`, not an enum — the picker
 * is the only thing that constrains it. So a company saved under "Other" comes
 * back as the words the employer typed ("Marine logistics"), which is NOT one of
 * the keys above. Selecting nothing in that case would silently blank a value
 * the employer had already given us the moment they opened the form to change
 * something else, so an unrecognised value re-opens as Other + its own text.
 */
function splitIndustry(stored: string | undefined | null): { key: string; other: string } {
  const value = stored?.trim() ?? '';
  if (!value) return { key: '', other: '' };
  /*
    Case-insensitive on purpose. The column is free text and has been written by
    more than this form — the seed stores "Construction", older rows may hold any
    casing — and matching exactly would drop every one of those into Other with
    the word echoed back, which looks like the picker simply does not work.
  */
  const match = (INDUSTRY_KEYS as readonly string[]).find(
    (k) => k.toLowerCase() === value.toLowerCase(),
  );
  return match ? { key: match, other: '' } : { key: INDUSTRY_OTHER, other: value };
}

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
  /*
    Two controls, one stored column: the picker holds a KEY, and `industryOther`
    holds the free text shown only when that key is `other`. `resolvedIndustry`
    below is what actually gets sent.
  */
  const [industryType, setIndustryType] = useState(() => splitIndustry(company?.industryType).key);
  const [industryOther, setIndustryOther] = useState(
    () => splitIndustry(company?.industryType).other,
  );
  const isOtherIndustry = industryType === INDUSTRY_OTHER;
  /**
   * What the server stores. Picking "Other" sends the TYPED words, not the
   * literal slug — "other" in the industry column tells nobody anything, and
   * this column is what admin review and the public company profile display.
   */
  const resolvedIndustry = isOtherIndustry ? industryOther.trim() : industryType;
  const [phoneCode, setPhoneCode] = useState(company?.phoneCode ?? DEFAULT_COUNTRY.dialCode);
  /*
    Which OPTION is selected, as an ISO code. Tracked separately from `phoneCode`
    because dial codes are not unique — +1 alone belongs to a dozen countries —
    so the code cannot identify a row in the picker. Only `phoneCode` is
    submitted; this exists purely so the control shows the right flag.
  */
  const [phoneIso, setPhoneIso] = useState(
    () =>
      optionForDialCode(company?.phoneCode ?? DEFAULT_COUNTRY.dialCode)?.iso ?? DEFAULT_COUNTRY.iso,
  );
  const [phone, setPhone] = useState(company?.phone ?? '');
  const [country, setCountry] = useState(company?.country ?? '');
  const [location, setLocation] = useState(company?.location ?? '');
  const [website, setWebsite] = useState(company?.website ?? '');
  // Held as a STRING: a number input's value is a string, and coercing on every
  // keystroke turns a half-typed "20" into 20 and fights the user's typing.
  const [foundedYear, setFoundedYear] = useState(
    company?.foundedYear != null ? String(company.foundedYear) : '',
  );
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

    if (!registrationNumber.trim()) next.registrationNumber = t('registrationNumberRequired');
    // The picker itself is now required. "Other" additionally requires its text,
    // checked below — choosing Other and typing nothing says less than not
    // choosing at all.
    if (!industryType) next.industryType = t('industryTypeRequired');

    const trimmedYear = foundedYear.trim();
    if (!trimmedYear) next.foundedYear = t('foundedYearRequired');
    else {
      const year = Number(trimmedYear);
      const maxYear = new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < FOUNDED_YEAR_MIN || year > maxYear) {
        next.foundedYear = t('foundedYearInvalid', { min: FOUNDED_YEAR_MIN, max: maxYear });
      }
    }

    const trimmedWebsite = website.trim();
    if (!trimmedWebsite) next.website = t('websiteRequired');
    // Mirrors @IsUrl on the DTO. Checked here so a bad address is pointed at the
    // field rather than coming back as a 400 the form cannot attribute.
    else if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(trimmedWebsite))
      next.website = t('websiteInvalid');

    if (!description.trim()) next.description = t('descriptionRequired');

    if (!phoneCode.trim()) next.phoneCode = t('phoneCodeRequired');
    if (!phone.trim()) next.phone = t('phoneRequired');
    if (!country) next.country = t('countryRequired');
    if (!location.trim()) next.location = t('locationRequired');
    if (!employeeRange) next.employeeRange = t('employeeRangeRequired');
    /*
      Only when "Other" is chosen. The picker itself stays optional — but having
      chosen Other and typed nothing, `industryType` would go up empty and the
      employer would have said less than if they had left the picker alone.
      Length mirrors the DTO so a too-long value is caught here rather than
      coming back as a 400 the form cannot point at a field.
    */
    if (isOtherIndustry) {
      const trimmedOther = industryOther.trim();
      if (!trimmedOther) next.industryOther = t('industryOtherRequired');
      else if (trimmedOther.length > INDUSTRY_TYPE_MAX)
        next.industryOther = t('industryOtherTooLong', { max: INDUSTRY_TYPE_MAX });
    }
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
          // Sent unconditionally — validate() has already refused an empty one,
          // so `|| undefined` here could only ever hide a bug from the server.
          registrationNumber: registrationNumber.trim(),
          industryType: resolvedIndustry,
          foundedYear: Number(foundedYear.trim()),
          website: website.trim(),
          description: description.trim(),
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
          // Sent unconditionally — validate() has already refused an empty one,
          // so `|| undefined` here could only ever hide a bug from the server.
          registrationNumber: registrationNumber.trim(),
          industryType: resolvedIndustry,
          foundedYear: Number(foundedYear.trim()),
          website: website.trim(),
          description: description.trim(),
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

        <Field
          id="ob-regnum"
          label={t('registrationNumberLabel')}
          error={errors.registrationNumber}
          required
        >
          <Input
            id="ob-regnum"
            type="text"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={t('registrationNumberPlaceholder')}
            maxLength={100}
            hasError={!!errors.registrationNumber}
          />
        </Field>

        <Field id="ob-founded" label={t('foundedYearLabel')} error={errors.foundedYear} required>
          <Input
            id="ob-founded"
            type="number"
            inputMode="numeric"
            min={FOUNDED_YEAR_MIN}
            max={new Date().getUTCFullYear()}
            value={foundedYear}
            onChange={(e) => setFoundedYear(e.target.value)}
            placeholder={t('foundedYearPlaceholder')}
            hasError={!!errors.foundedYear}
          />
        </Field>

        <div className="flex flex-col gap-3">
          <Field
            id="ob-industry"
            label={t('industryTypeLabel')}
            error={errors.industryType}
            required
          >
            <select
              id="ob-industry"
              value={industryType}
              aria-invalid={!!errors.industryType}
              onChange={(e) => {
                setIndustryType(e.target.value);
                setErrors((prev) => ({ ...prev, industryType: '' }));
                // Moving off Other drops the text with it, so a stale value
                // cannot be submitted by a picker that no longer shows it.
                if (e.target.value !== INDUSTRY_OTHER) setIndustryOther('');
                setErrors((prev) => ({ ...prev, industryOther: '' }));
              }}
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

          {/*
            Revealed only by "Other". Rendered as a sibling rather than inside the
            select's Field so it gets its own label and error slot — an employer
            typing a free-form industry needs to see WHICH input the error is
            about, and `Field` binds one message to one control.
          */}
          {isOtherIndustry && (
            <Field
              id="ob-industry-other"
              label={t('industryOtherLabel')}
              error={errors.industryOther}
              required
            >
              <Input
                id="ob-industry-other"
                type="text"
                value={industryOther}
                maxLength={INDUSTRY_TYPE_MAX}
                autoFocus
                aria-invalid={!!errors.industryOther}
                onChange={(e) => {
                  setIndustryOther(e.target.value);
                  setErrors((prev) => ({ ...prev, industryOther: '' }));
                }}
                placeholder={t('industryOtherPlaceholder')}
              />
            </Field>
          )}
        </div>

        {/* Dial code + number share a row; the code is its own column server-side. */}
        <div className="flex gap-2">
          {/* Compact: flag + dial code only. The name would push the number input
              below 12rem on a 360px screen, and the full name is one tap away in
              the list. */}
          <div className="w-32 shrink-0">
            <Field id="ob-phonecode" label={t('phoneCodeLabel')} error={errors.phoneCode} required>
              <CountryCodeSelect
                id="ob-phonecode"
                compact
                value={phoneIso}
                invalid={!!errors.phoneCode}
                searchLabel={t('phoneCodeSearch')}
                emptyLabel={t('phoneCodeEmpty')}
                onChange={(picked) => {
                  setPhoneIso(picked.iso);
                  setPhoneCode(picked.dialCode);
                }}
              />
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
              if (code) {
                setPhoneCode(code);
                // ...and move the picker's selection with it, or the control
                // would keep showing the previous country's flag beside a code
                // that had silently changed underneath it.
                const iso = COUNTRIES.find((c) => c.name === next)?.iso;
                if (iso) setPhoneIso(iso);
              }
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

        <Field id="ob-website" label={t('websiteLabel')} error={errors.website} required>
          <Input
            id="ob-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder={t('websitePlaceholder')}
            autoComplete="url"
            maxLength={300}
            hasError={!!errors.website}
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

        <Field
          id="ob-desc"
          label={t('descriptionLabel')}
          error={errors.description}
          required
          className="sm:col-span-2"
        >
          <textarea
            id="ob-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('descriptionPlaceholder')}
            rows={3}
            maxLength={2000}
            aria-invalid={!!errors.description}
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

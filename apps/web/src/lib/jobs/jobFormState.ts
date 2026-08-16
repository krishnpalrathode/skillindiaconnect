import type { components } from '@skillindiaconnect/shared-types';
import type { Job, CreateJobBody } from '@/lib/api/jobs-employer';
import { countriesForMarket } from '@/lib/countries';
import { CURRENCIES } from '@/lib/currencies';
import { JOB_POSTING_TERMS_VERSION } from '@/lib/jobs/jobPostingTerms';

type JobMarket = components['schemas']['JobMarket'];
type GenderPreference = components['schemas']['GenderPreference'];
type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
type ContractDuration = components['schemas']['ContractDuration'];

/**
 * Minimum job-description length. Mirrors JOB_DESCRIPTION_MIN in the API's
 * create-job DTO — checked here so a thin description is pointed at the field
 * instead of coming back as a 400 the form cannot attribute.
 */
export const JOB_DESCRIPTION_MIN = 300;

/** The contract-length bands, in order, with the copy the dropdown shows. */
export const CONTRACT_DURATIONS: ReadonlyArray<{ value: ContractDuration; label: string }> = [
  { value: 'MONTHS_1_6', label: '1–6 months' },
  { value: 'MONTHS_6_12', label: '6–12 months' },
  { value: 'YEARS_1_2', label: '1–2 years' },
  { value: 'YEARS_2_5', label: '2–5 years' },
];

export interface JobFormValues {
  title: string;
  employmentType: EmploymentType;
  /** Empty unless employmentType is CONTRACT — the API rejects it otherwise. */
  contractDuration: ContractDuration | '';
  market: JobMarket;
  country: string;
  categoryId: string;
  /**
   * What the employer typed after choosing "Other". Held even while a fixed
   * trade is selected so switching away and back does not lose their words;
   * `formToPayload` is what decides whether it is actually sent.
   */
  categoryOther: string;
  location: string;
  description: string;
  salaryCurrency: string;
  salaryMin: string;
  salaryMax: string;
  /*
    Worker-protection guarantees. Locked ON for a GULF job — the platform will
    not publish an overseas posting without them — but ordinary optional toggles
    for a LOCAL one, where the worker sleeps at home and arranges their own
    transport. Typed boolean, not literal true, because LOCAL can now say false.
  */
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  // Optional benefits
  foodAllowance: boolean;
  airTickets: boolean;
  otherAllowance: string;
  // Work conditions (structured — map to hoursPerDay/daysPerWeek/overtime columns)
  hoursPerDay: string;
  daysPerWeek: string;
  overtime: boolean;
  // Requirements checklist
  requirements: string[];
  // Additional fields
  experienceRequiredYears: string;
  vacancies: string;
  genderPreference: GenderPreference;
  /** Ticked the job-posting terms. Not persisted as a boolean — see formToPayload. */
  termsAccepted: boolean;
}

export interface JobFormErrors {
  title?: string;
  employmentType?: string;
  market?: string;
  country?: string;
  categoryId?: string;
  categoryOther?: string;
  location?: string;
  description?: string;
  contractDuration?: string;
  salaryCurrency?: string;
  salaryMin?: string;
  salaryMax?: string;
  hoursPerDay?: string;
  daysPerWeek?: string;
  requirements?: string;
  termsAccepted?: string;
  [key: string]: string | undefined;
}

export const GULF_CURRENCIES = ['AED', 'QAR', 'SAR', 'OMR', 'KWD', 'BHD'];
export const LOCAL_CURRENCIES = ['INR'];

/**
 * Every currency a job may pay in — the full set the API's Currency enum accepts.
 *
 * The form used to offer only the six GCC codes on a Gulf job, and INR alone on
 * a local one. That was narrower than the platform itself: the enum, and the
 * candidate's own salary-expectation dropdown, have carried USD, EUR, GBP and
 * the rest for a while, so an employer paying a Gulf posting in dollars had no
 * way to say so. The market now chooses the DEFAULT rather than the whole list.
 */
export function getCurrenciesForMarket(_market: JobMarket): string[] {
  return CURRENCIES.map((c) => c.code);
}

/** The code pre-selected for a market — still corridor-aware, just not a cage. */
export function defaultCurrencyForMarket(market: JobMarket): string {
  return market === 'GULF' ? 'AED' : 'INR';
}

export const DEFAULT_FORM_VALUES: JobFormValues = {
  title: '',
  employmentType: 'FULL_TIME',
  market: 'GULF',
  country: '',
  categoryId: '',
  categoryOther: '',
  contractDuration: '',
  location: '',
  description: '',
  salaryCurrency: 'AED',
  salaryMin: '',
  salaryMax: '',
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  foodAllowance: false,
  airTickets: false,
  otherAllowance: '',
  hoursPerDay: '8',
  daysPerWeek: '6',
  overtime: false,
  requirements: [],
  experienceRequiredYears: '',
  vacancies: '',
  genderPreference: 'ANY',
  // Never pre-ticked. A pre-accepted consent box is not consent.
  termsAccepted: false,
};

/**
 * `otherCategoryId` is the id of the seeded "Other" category, which only the
 * caller knows (it comes from GET /job-categories). Omit it and the free-text
 * rule is simply not checked client-side — the server enforces it either way
 * with CATEGORY_OTHER_REQUIRED.
 */
export function validateJobForm(values: JobFormValues, otherCategoryId?: string): JobFormErrors {
  const errors: JobFormErrors = {};
  if (!values.title.trim()) errors.title = 'Job title is required';
  if (!values.country) {
    errors.country = 'Country is required';
  } else if (!countriesForMarket(values.market).some((c) => c.name === values.country)) {
    errors.country = 'Select a country valid for the chosen market';
  }
  if (!values.categoryId) errors.categoryId = 'Job category is required';
  if (otherCategoryId && values.categoryId === otherCategoryId && !values.categoryOther.trim()) {
    errors.categoryOther = 'Enter the job category';
  }
  if (!values.location.trim()) errors.location = 'Location is required';
  const trimmedDescription = values.description.trim();
  if (!trimmedDescription) errors.description = 'Job description is required';
  else if (trimmedDescription.length < JOB_DESCRIPTION_MIN) {
    // Names the shortfall rather than just the rule: "add 140 more" is
    // actionable, "must be at least 300" makes the writer count for themselves.
    errors.description = `Job description must be at least ${JOB_DESCRIPTION_MIN} characters — ${JOB_DESCRIPTION_MIN - trimmedDescription.length} more to go`;
  }

  // The band is required exactly when the role is a contract, mirroring the
  // server's pairing rule so the employer sees it on the field, not as a 400.
  if (values.employmentType === 'CONTRACT' && !values.contractDuration) {
    errors.contractDuration = 'Select how long the contract runs';
  }

  if (!values.termsAccepted) {
    errors.termsAccepted = 'Accept the terms for this posting to continue';
  }

  if (!values.salaryCurrency) errors.salaryCurrency = 'Currency is required';

  // Salary is required — the DB stores non-null min/max.
  const min = values.salaryMin ? parseInt(values.salaryMin, 10) : null;
  const max = values.salaryMax ? parseInt(values.salaryMax, 10) : null;
  if (min === null || isNaN(min)) errors.salaryMin = 'Minimum salary is required';
  if (max === null || isNaN(max)) errors.salaryMax = 'Maximum salary is required';
  if (min !== null && max !== null && !isNaN(min) && !isNaN(max) && min > max) {
    errors.salaryMin = 'Minimum must be less than or equal to maximum';
  }

  // Working hours are required (non-null columns, 1-24 / 1-7).
  const hpd = values.hoursPerDay ? parseInt(values.hoursPerDay, 10) : null;
  const dpw = values.daysPerWeek ? parseInt(values.daysPerWeek, 10) : null;
  if (hpd === null || isNaN(hpd) || hpd < 1 || hpd > 24)
    errors.hoursPerDay = 'Enter hours per day (1–24)';
  if (dpw === null || isNaN(dpw) || dpw < 1 || dpw > 7)
    errors.daysPerWeek = 'Enter days per week (1–7)';

  return errors;
}

// Produces the exact backend CreateJobDto shape. Numeric string fields are
// parsed; salary + hours are guaranteed present by validateJobForm before this
// is called, so they're sent as numbers (not null).
export function formToPayload(values: JobFormValues, otherCategoryId?: string): CreateJobBody {
  const min = parseInt(values.salaryMin, 10);
  const max = parseInt(values.salaryMax, 10);
  const hpd = parseInt(values.hoursPerDay, 10);
  const dpw = parseInt(values.daysPerWeek, 10);
  const exp = values.experienceRequiredYears
    ? parseInt(values.experienceRequiredYears, 10)
    : undefined;
  const vac = values.vacancies ? parseInt(values.vacancies, 10) : undefined;

  return {
    title: values.title.trim(),
    employmentType: values.employmentType,
    market: values.market,
    country: values.country,
    location: values.location.trim(),
    description: values.description.trim(),
    categoryId: values.categoryId,
    // Sent ONLY alongside the "Other" category — the API rejects free text
    // paired with a fixed trade, which is exactly what a stale draft value
    // would be if this were sent unconditionally.
    ...(otherCategoryId && values.categoryId === otherCategoryId && values.categoryOther.trim()
      ? { categoryOther: values.categoryOther.trim() }
      : {}),
    requirements: values.requirements.filter((r) => r.trim().length > 0),
    ...(exp !== undefined && !isNaN(exp) ? { experienceRequiredYears: exp } : {}),
    salaryMin: min,
    salaryMax: max,
    currency: values.salaryCurrency,
    // Sent ONLY for a contract role. The server rejects a duration on a
    // full-time job, so an omitted key is the correct wire shape, not a gap.
    ...(values.employmentType === 'CONTRACT' && values.contractDuration
      ? { contractDuration: values.contractDuration }
      : {}),
    // Send what the form actually holds. These were hardcoded true, which meant
    // a LOCAL employer who unticked accommodation still published a job claiming
    // to provide it — a promise to the worker that nobody had made.
    accommodation: values.accommodation,
    healthInsurance: values.healthInsurance,
    transportation: values.transportation,
    foodAllowance: values.foodAllowance,
    // A single "air tickets" toggle covers both legs.
    airTicketArrival: values.airTickets,
    airTicketDeparture: values.airTickets,
    ...(values.otherAllowance.trim() ? { otherAllowance: values.otherAllowance.trim() } : {}),
    hoursPerDay: hpd,
    daysPerWeek: dpw,
    overtime: values.overtime,
    ...(vac !== undefined && !isNaN(vac) ? { vacancies: vac } : {}),
    genderPreference: values.genderPreference,
    /*
      The VERSION, not the tick. What matters later is which text was agreed to,
      and a boolean cannot answer that. validateJobForm has already refused an
      unticked box, so reaching here means the employer accepted this version.
    */
    acceptedTermsVersion: JOB_POSTING_TERMS_VERSION,
  };
}

export function jobToFormValues(job: Job): JobFormValues {
  return {
    title: job.title,
    employmentType: job.employmentType,
    market: job.market,
    country: job.country ?? '',
    categoryId: job.categoryId,
    categoryOther: job.categoryOther ?? '',
    contractDuration: job.contractDuration ?? '',
    location: job.location,
    description: job.description ?? '',
    salaryCurrency: job.currency,
    salaryMin: job.salaryMin != null ? String(job.salaryMin) : '',
    salaryMax: job.salaryMax != null ? String(job.salaryMax) : '',
    // Read what the job ACTUALLY stores. Hardcoding true here silently flipped a
    // LOCAL job's protections back on every time the employer opened Edit.
    accommodation: job.accommodation ?? true,
    healthInsurance: job.healthInsurance ?? true,
    transportation: job.transportation ?? true,
    foodAllowance: job.foodAllowance ?? false,
    airTickets: (job.airTicketArrival ?? false) || (job.airTicketDeparture ?? false),
    otherAllowance: job.otherAllowance ?? '',
    hoursPerDay: job.hoursPerDay != null ? String(job.hoursPerDay) : '8',
    daysPerWeek: job.daysPerWeek != null ? String(job.daysPerWeek) : '6',
    overtime: job.overtime ?? false,
    requirements: job.requirements ?? [],
    experienceRequiredYears:
      job.experienceRequiredYears != null ? String(job.experienceRequiredYears) : '',
    vacancies: job.vacancies != null ? String(job.vacancies) : '',
    genderPreference: (job.genderPreference as GenderPreference) ?? 'ANY',
    /*
      Re-tick required on every save, even when editing a job that already
      carries an acceptance. The terms are accepted FOR A POSTING, and an edit
      changes the posting — silently reusing the old tick would record agreement
      to terms the employer never re-read against the new content.
    */
    termsAccepted: false,
  };
}

// Preview shape — a subset of JobCard for the live preview panel
export interface PreviewJobCard {
  id: string;
  title: string;
  market: JobMarket;
  country: string | null;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  companyName: string;
  createdAt: string;
  publishedAt: null;
  isSaved: null;
}

export function formToPreview(values: JobFormValues, companyName: string): PreviewJobCard {
  const min = values.salaryMin ? parseInt(values.salaryMin, 10) : null;
  const max = values.salaryMax ? parseInt(values.salaryMax, 10) : null;
  return {
    id: 'preview',
    title: values.title.trim() || 'Job Title',
    market: values.market,
    country: values.country || null,
    location: values.location.trim() || 'Location',
    salaryMin: min !== null && !isNaN(min) ? min : null,
    salaryMax: max !== null && !isNaN(max) ? max : null,
    salaryCurrency: values.salaryCurrency,
    accommodation: values.accommodation,
    healthInsurance: values.healthInsurance,
    transportation: values.transportation,
    companyName,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    isSaved: null,
  };
}

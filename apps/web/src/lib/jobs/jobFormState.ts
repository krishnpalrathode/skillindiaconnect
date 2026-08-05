import type { components } from '@skillindiaconnect/shared-types';
import type { Job, CreateJobBody } from '@/lib/api/jobs-employer';
import { countriesForMarket } from '@/lib/countries';

type JobMarket = components['schemas']['JobMarket'];
type GenderPreference = components['schemas']['GenderPreference'];
type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';

export interface JobFormValues {
  title: string;
  employmentType: EmploymentType;
  market: JobMarket;
  country: string;
  categoryId: string;
  location: string;
  description: string;
  salaryCurrency: string;
  salaryMin: string;
  salaryMax: string;
  // Mandatory locked benefits
  accommodation: true;
  healthInsurance: true;
  transportation: true;
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
}

export interface JobFormErrors {
  title?: string;
  employmentType?: string;
  market?: string;
  country?: string;
  categoryId?: string;
  location?: string;
  description?: string;
  salaryCurrency?: string;
  salaryMin?: string;
  salaryMax?: string;
  hoursPerDay?: string;
  daysPerWeek?: string;
  requirements?: string;
  [key: string]: string | undefined;
}

export const GULF_CURRENCIES = ['AED', 'QAR', 'SAR', 'OMR', 'KWD', 'BHD'];
export const LOCAL_CURRENCIES = ['INR'];

export function getCurrenciesForMarket(market: JobMarket): string[] {
  return market === 'GULF' ? GULF_CURRENCIES : LOCAL_CURRENCIES;
}

export const DEFAULT_FORM_VALUES: JobFormValues = {
  title: '',
  employmentType: 'FULL_TIME',
  market: 'GULF',
  country: '',
  categoryId: '',
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
};

export function validateJobForm(values: JobFormValues): JobFormErrors {
  const errors: JobFormErrors = {};
  if (!values.title.trim()) errors.title = 'Job title is required';
  if (!values.country) {
    errors.country = 'Country is required';
  } else if (!countriesForMarket(values.market).some((c) => c.name === values.country)) {
    errors.country = 'Select a country valid for the chosen market';
  }
  if (!values.categoryId) errors.categoryId = 'Job category is required';
  if (!values.location.trim()) errors.location = 'Location is required';
  if (!values.description.trim()) errors.description = 'Job description is required';
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
export function formToPayload(values: JobFormValues): CreateJobBody {
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
    requirements: values.requirements.filter((r) => r.trim().length > 0),
    ...(exp !== undefined && !isNaN(exp) ? { experienceRequiredYears: exp } : {}),
    salaryMin: min,
    salaryMax: max,
    currency: values.salaryCurrency,
    accommodation: true,
    healthInsurance: true,
    transportation: true,
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
  };
}

export function jobToFormValues(job: Job): JobFormValues {
  return {
    title: job.title,
    employmentType: job.employmentType,
    market: job.market,
    country: job.country ?? '',
    categoryId: job.categoryId,
    location: job.location,
    description: job.description ?? '',
    salaryCurrency: job.currency,
    salaryMin: job.salaryMin != null ? String(job.salaryMin) : '',
    salaryMax: job.salaryMax != null ? String(job.salaryMax) : '',
    accommodation: true,
    healthInsurance: true,
    transportation: true,
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
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    companyName,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    isSaved: null,
  };
}

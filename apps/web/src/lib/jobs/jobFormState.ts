import type { components } from '@skillindiaconnect/shared-types';

type Job = components['schemas']['Job'];
type JobMarket = components['schemas']['JobMarket'];
type GenderPreference = components['schemas']['GenderPreference'];

export interface JobFormValues {
  title: string;
  market: JobMarket;
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
  // Work conditions
  workConditions: string;
  // Requirements checklist
  requirements: string[];
  // Additional fields
  experienceRequiredYears: string;
  vacancies: string;
  genderPreference: GenderPreference;
}

export interface JobFormErrors {
  title?: string;
  market?: string;
  location?: string;
  salaryCurrency?: string;
  salaryMin?: string;
  salaryMax?: string;
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
  market: 'GULF',
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
  workConditions: '',
  requirements: [],
  experienceRequiredYears: '',
  vacancies: '',
  genderPreference: 'ANY',
};

export function validateJobForm(values: JobFormValues): JobFormErrors {
  const errors: JobFormErrors = {};
  if (!values.title.trim()) errors.title = 'Job title is required';
  if (!values.location.trim()) errors.location = 'Location is required';
  if (!values.salaryCurrency) errors.salaryCurrency = 'Currency is required';
  const min = values.salaryMin ? parseInt(values.salaryMin, 10) : null;
  const max = values.salaryMax ? parseInt(values.salaryMax, 10) : null;
  if (min !== null && isNaN(min)) errors.salaryMin = 'Must be a number';
  if (max !== null && isNaN(max)) errors.salaryMax = 'Must be a number';
  if (min !== null && max !== null && !isNaN(min) && !isNaN(max) && min > max) {
    errors.salaryMin = 'Minimum must be less than or equal to maximum';
  }
  return errors;
}

export function formToPayload(values: JobFormValues) {
  const min = values.salaryMin ? parseInt(values.salaryMin, 10) : null;
  const max = values.salaryMax ? parseInt(values.salaryMax, 10) : null;
  const exp = values.experienceRequiredYears ? parseInt(values.experienceRequiredYears, 10) : null;
  const vacancies = values.vacancies ? parseInt(values.vacancies, 10) : null;

  const extraConditions: string[] = [];
  if (values.foodAllowance) extraConditions.push('Food allowance included');
  if (values.airTickets) extraConditions.push('Air tickets (arrival & departure)');
  if (values.otherAllowance.trim()) extraConditions.push(`Other: ${values.otherAllowance.trim()}`);

  const workConditionsParts: string[] = [];
  if (values.workConditions.trim()) workConditionsParts.push(values.workConditions.trim());
  workConditionsParts.push(...extraConditions);

  return {
    title: values.title.trim(),
    market: values.market,
    location: values.location.trim(),
    description: values.description.trim() || undefined,
    salaryCurrency: values.salaryCurrency,
    salaryMin: min !== null && !isNaN(min) ? min : null,
    salaryMax: max !== null && !isNaN(max) ? max : null,
    accommodation: true as const,
    healthInsurance: true as const,
    transportation: true as const,
    workConditions: workConditionsParts.join('. ') || undefined,
    requirements: values.requirements.filter((r) => r.trim().length > 0),
    experienceRequiredYears: exp !== null && !isNaN(exp) ? exp : null,
    vacancies: vacancies !== null && !isNaN(vacancies) ? vacancies : null,
    genderPreference: values.genderPreference,
  };
}

export function jobToFormValues(job: Job): JobFormValues {
  return {
    title: job.title,
    market: job.market,
    location: job.location,
    description: job.description ?? '',
    salaryCurrency: job.salaryCurrency,
    salaryMin: job.salaryMin != null ? String(job.salaryMin) : '',
    salaryMax: job.salaryMax != null ? String(job.salaryMax) : '',
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    foodAllowance: false,
    airTickets: false,
    otherAllowance: '',
    workConditions: job.workConditions ?? '',
    requirements: job.requirements ?? [],
    experienceRequiredYears:
      job.experienceRequiredYears != null ? String(job.experienceRequiredYears) : '',
    vacancies: job.vacancies != null ? String(job.vacancies) : '',
    genderPreference: job.genderPreference ?? 'ANY',
  };
}

// Preview shape — a subset of JobCard for the live preview panel
export interface PreviewJobCard {
  id: string;
  title: string;
  market: JobMarket;
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

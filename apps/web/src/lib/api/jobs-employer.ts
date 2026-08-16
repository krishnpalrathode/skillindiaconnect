import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';

export type JobStatus = components['schemas']['JobStatus'];
export type JobMarket = components['schemas']['JobMarket'];

// The employer's own job endpoints return the FULL job row (not the public
// JobCard subset), so this reflects the real response shape — including
// `currency`, `employmentType`, `hoursPerDay`, `daysPerWeek` etc. that the
// public `Job` contract schema omits. Used by the edit form and My Jobs table.
export interface Job {
  id: string;
  humanId: string;
  companyId: string;
  title: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  market: JobMarket;
  status: JobStatus;
  /** Recruiting country (canonical English name); null on pre-feature jobs. */
  country: string | null;
  location: string;
  description: string;
  categoryId: string;
  /** Free-text trade; non-null only when `categoryId` is the "Other" category. */
  categoryOther: string | null;
  requirements: string[];
  experienceRequiredYears: number | null;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  foodAllowance: boolean;
  airTicketArrival: boolean;
  airTicketDeparture: boolean;
  otherAllowance: string | null;
  hoursPerDay: number;
  daysPerWeek: number;
  overtime: boolean;
  overtimeRateSubunits: number | null;
  /** @deprecated Never collected by any form; use `contractDuration`. */
  contractPeriodMonths: number | null;
  /** Null unless `employmentType` is CONTRACT. */
  contractDuration: components['schemas']['ContractDuration'] | null;
  /** Which terms version this job was posted under; null for pre-terms jobs. */
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  vacancies: number | null;
  genderPreference: string | null;
  isFeatured: boolean;
  isUrgent: boolean;
  publishedAt: string | null;
  pausedAt: string | null;
  archivedAt: string | null;
  autoArchiveAt: string | null;
  viewsCount: number;
  /** Live applicant count (S4). Optional — omitted before S4 / on older payloads. */
  applicantCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
  nameAr: string | null;
}

// Mirrors the backend CreateJobDto exactly (apps/api/src/jobs/dto/create-job.dto.ts).
// The form builds this via formToPayload — every required field is present.
export interface CreateJobBody {
  title: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  market: JobMarket;
  country: string;
  location: string;
  description: string;
  categoryId: string;
  /** Free-text trade; send ONLY with the "Other" category (422 otherwise). */
  categoryOther?: string;
  requirements: string[];
  experienceRequiredYears?: number;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  foodAllowance: boolean;
  airTicketArrival: boolean;
  airTicketDeparture: boolean;
  otherAllowance?: string;
  hoursPerDay: number;
  daysPerWeek: number;
  overtime: boolean;
  /**
   * Send ONLY with `employmentType: 'CONTRACT'`.
   *
   * Required for a contract role (400 `CONTRACT_DURATION_REQUIRED`) and rejected
   * for any other type (400 `CONTRACT_DURATION_NOT_APPLICABLE`) — the server
   * pairs the two fields, so an omitted key is the correct shape here, not a gap.
   */
  contractDuration?: components['schemas']['ContractDuration'];
  vacancies?: number;
  genderPreference?: string;
  /** The VERSION of the job-posting terms accepted. Required by the API. */
  acceptedTermsVersion: string;
}

/** Public — active job categories for the post-a-job picker and search filter. */
export function getJobCategories(): Promise<{ data: JobCategory[] }> {
  return apiFetchRaw<{ data: JobCategory[] }>('/job-categories');
}

export interface MyJobsResult {
  data: Job[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; sort?: string };
}

export function listMyJobs(params?: {
  status?: JobStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}): Promise<MyJobsResult> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.sort) qs.set('sort', params.sort);
  const query = qs.toString();
  return apiFetchRaw<MyJobsResult>(`/employers/me/jobs${query ? `?${query}` : ''}`);
}

/**
 * ONE job, read as its owner.
 *
 * The edit screen used to load through the PUBLIC `GET /jobs/{id}`, which serves
 * only publicly-visible jobs. That works for an ACTIVE job and 404s for a DRAFT
 * or PAUSED one — so Edit was broken for exactly the jobs an employer most needs
 * to edit: the ones not yet live. The employer-scoped route returns the job at
 * ANY status and enforces ownership server-side, which is what an owner-only
 * screen should be reading anyway.
 *
 * Same base as every other employer job call below — the read was the one
 * outlier.
 */
export function getMyJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}`);
}

// Employer job mutations live under /employers/me/jobs (the employer-scoped
// JobsController), NOT the public /jobs search routes. listMyJobs above already
// uses this prefix; keep every write on the same base.
export function createJob(body: CreateJobBody): Promise<Job> {
  return apiFetch<Job>('/employers/me/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateJob(id: string, body: Partial<CreateJobBody>): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function publishJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export function pauseJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' });
}

export function resumeJobAction(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export function archiveJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export function duplicateJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/employers/me/jobs/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
}

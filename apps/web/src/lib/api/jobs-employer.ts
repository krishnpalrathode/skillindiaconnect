import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from '@/lib/api/client';

export type Job = components['schemas']['Job'];
export type JobStatus = components['schemas']['JobStatus'];
export type JobMarket = components['schemas']['JobMarket'];

export interface CreateJobBody {
  title: string;
  market: JobMarket;
  location: string;
  description?: string;
  categoryId?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency: string;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  workConditions?: string;
  requirements?: string[];
  experienceRequiredYears?: number | null;
  vacancies?: number | null;
  genderPreference?: 'MALE' | 'FEMALE' | 'ANY';
}

export interface MyJobsResult {
  data: Job[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function listMyJobs(params?: {
  status?: JobStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<MyJobsResult> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  return apiFetchRaw<MyJobsResult>(`/employers/me/jobs${query ? `?${query}` : ''}`);
}

export function createJob(body: CreateJobBody): Promise<Job> {
  return apiFetch<Job>('/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateJob(id: string, body: Partial<CreateJobBody>): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function publishJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export function pauseJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' });
}

export function resumeJobAction(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export function archiveJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export function duplicateJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
}

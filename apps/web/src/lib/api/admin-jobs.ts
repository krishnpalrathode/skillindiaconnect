import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';

export type AdminJobRow = components['schemas']['AdminJobRow'];
export type AdminJobDetail = components['schemas']['AdminJobDetail'];
export type JobStatus = components['schemas']['JobStatus'];
export type Job = components['schemas']['Job'];

export interface JobListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort?: string;
}

export interface JobListPage {
  data: AdminJobRow[];
  meta: JobListMeta;
}

export interface JobListQuery {
  status?: JobStatus;
  employerId?: string;
  search?: string;
  featured?: boolean;
  urgent?: boolean;
  page?: number;
  pageSize?: number;
  /** `field:dir`; clamped server-side. */
  sort?: string;
}

/** Offset list — EVERY status (incl. DRAFT / PENDING_REVIEW). RBAC: jobs.view. */
export function listAdminJobs(query: JobListQuery = {}): Promise<JobListPage> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.employerId) params.set('employerId', query.employerId);
  if (query.search) params.set('search', query.search);
  if (query.featured !== undefined) params.set('featured', String(query.featured));
  if (query.urgent !== undefined) params.set('urgent', String(query.urgent));
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  // Raw fetch: the offset envelope carries `meta`, which apiFetch would discard.
  return apiFetchRaw<JobListPage>(`/admin/jobs${qs ? `?${qs}` : ''}`);
}

/**
 * The moderation detail (0.8.1): the FULL job for ANY status — the public
 * detail is ACTIVE-only, so this is the only way to see a PENDING_REVIEW job
 * as candidates would. Carries `companyStatus` so the panel can warn about a
 * suspended employer BEFORE an approve attempt. RBAC: jobs.view.
 */
export function getAdminJob(id: string): Promise<AdminJobDetail> {
  return apiFetch<AdminJobDetail>(`/admin/jobs/${id}`);
}

/**
 * Resolve a PENDING_REVIEW job. RBAC: jobs.moderate.
 *
 * APPROVE **re-runs the full publish gate ladder** — the world may have moved
 * while the job sat in review, so this call can honestly fail with
 * EMPLOYER_NOT_APPROVED (403), WORKER_PROTECTION_VIOLATION (422,
 * meta.violations names the failing rules) or JOB_QUOTA_EXCEEDED (422). Those
 * are the system working correctly — the caller renders the explainer, never
 * a generic error. REJECT requires `reason` (422 REVIEW_REASON_REQUIRED
 * otherwise); the reason is EMPLOYER-VISIBLE. 409 JOB_NOT_PENDING_REVIEW when
 * there is nothing to resolve.
 */
export function reviewJob(
  id: string,
  decision: 'APPROVE' | 'REJECT',
  reason?: string,
): Promise<AdminJobRow> {
  return apiFetch<AdminJobRow>(`/admin/jobs/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(reason ? { decision, reason } : { decision }),
  });
}

/** ACTIVE → PAUSED on ANY employer's job. 409 on an illegal transition. RBAC: jobs.moderate. */
export function pauseJob(id: string, reason?: string): Promise<AdminJobRow> {
  return apiFetch<AdminJobRow>(`/admin/jobs/${id}/pause`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/** ACTIVE/PAUSED → ARCHIVED (terminal; leaves public search). RBAC: jobs.moderate. */
export function archiveJob(id: string, reason?: string): Promise<AdminJobRow> {
  return apiFetch<AdminJobRow>(`/admin/jobs/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/**
 * Featured / Urgent — ADMIN-SET ONLY (an employer can never set them, which is
 * what keeps them meaningful). Omitted fields stay unchanged. The backend
 * invalidates the search cache; the UI just refetches. RBAC: jobs.moderate.
 */
export function setJobFlags(
  id: string,
  flags: { featured?: boolean; urgent?: boolean },
): Promise<AdminJobRow> {
  return apiFetch<AdminJobRow>(`/admin/jobs/${id}/flags`, {
    method: 'PATCH',
    body: JSON.stringify(flags),
  });
}

/**
 * On-behalf creation (RBAC: jobs.post_admin — the contract reuses this key,
 * decision 4). `payload` is the SAME CreateJobDto shape the employer form
 * sends (see lib/jobs/jobFormState.formToPayload — protection benefits always
 * true). `publish: true` runs the IDENTICAL gate ladder against the TARGET
 * employer; a passing publish goes straight to ACTIVE (the admin IS the
 * reviewer). Omitted → DRAFT, which always succeeds.
 */
export function createJobOnBehalf(
  employerId: string,
  payload: Record<string, unknown>,
  publish: boolean,
): Promise<Job> {
  return apiFetch<Job>('/admin/jobs', {
    method: 'POST',
    body: JSON.stringify({ ...payload, employerId, ...(publish ? { publish: true } : {}) }),
  });
}

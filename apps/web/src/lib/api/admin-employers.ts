import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';

export type Company = components['schemas']['Company'];
export type CompanyStatus = components['schemas']['CompanyStatus'];
export type CompanyType = components['schemas']['CompanyType'];
export type DocumentUrlGrant = components['schemas']['DocumentUrlGrant'];

export interface EmployerListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** The sort the SERVER applied — may differ from what was asked if clamped. */
  sort?: string;
}

export interface EmployerListPage {
  data: Company[];
  meta: EmployerListMeta;
}

export interface EmployerListQuery {
  status?: CompanyStatus;
  type?: CompanyType;
  search?: string;
  page?: number;
  pageSize?: number;
  /** `field:dir`. Unknown fields are clamped server-side, never rejected. */
  sort?: string;
}

/** Offset list (admin table shape: { data, meta }). RBAC: employers.view. */
export function listEmployers(query: EmployerListQuery = {}): Promise<EmployerListPage> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  // Raw fetch: the offset envelope carries `meta`, which apiFetch would discard.
  return apiFetchRaw<EmployerListPage>(`/admin/employers${qs ? `?${qs}` : ''}`);
}

/** One company for the review detail. RBAC: employers.view. */
export function getEmployer(id: string): Promise<Company> {
  return apiFetch<Company>(`/admin/employers/${id}`);
}

/**
 * Mint a SHORT-EXPIRY signed URL for the registration certificate. Every call is
 * audited server-side (document.viewed) — so the UI fetches it when the viewer
 * actually opens, not eagerly for every row.
 * 404 = company unknown OR no certificate on file (indistinguishable by design).
 */
export function getCertificateUrl(id: string): Promise<DocumentUrlGrant> {
  return apiFetch<DocumentUrlGrant>(`/admin/employers/${id}/certificate/url`);
}

/** PENDING → APPROVED. RBAC: employers.approve_reject. */
export function approveEmployer(id: string): Promise<Company> {
  return apiFetch<Company>(`/admin/employers/${id}/approve`, { method: 'POST' });
}

/** PENDING → REJECTED. `reason` is REQUIRED and shown to the employer. */
export function rejectEmployer(id: string, reason: string): Promise<Company> {
  return apiFetch<Company>(`/admin/employers/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * APPROVED → SUSPENDED. Pauses ALL of the company's active jobs (server-side
 * cascade). RBAC: employers.suspend — a higher grant than approve_reject.
 * NOTE: the API takes no reason — there is no suspension-reason field to store
 * one in (only rejectionReason exists). The dialog therefore confirms the
 * consequence but does not collect text that would silently go nowhere.
 */
export function suspendEmployer(id: string): Promise<Company> {
  return apiFetch<Company>(`/admin/employers/${id}/suspend`, { method: 'POST' });
}

/** SUSPENDED → APPROVED. Jobs stay paused (resumed manually by the employer). */
export function reactivateEmployer(id: string): Promise<Company> {
  return apiFetch<Company>(`/admin/employers/${id}/reactivate`, { method: 'POST' });
}

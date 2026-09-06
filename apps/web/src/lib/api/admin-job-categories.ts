import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';

export type AdminJobCategory = components['schemas']['AdminJobCategory'];

export interface CreateJobCategoryInput {
  slug: string;
  nameEn: string;
  nameHi?: string;
  nameAr?: string;
  isActive?: boolean;
}

export interface UpdateJobCategoryInput {
  nameEn?: string;
  nameHi?: string;
  nameAr?: string;
  isActive?: boolean;
}

/** RBAC: job_categories.manage. Every category incl. inactive, with job counts. */
export function getAdminJobCategories(): Promise<AdminJobCategory[]> {
  return apiFetch<AdminJobCategory[]>('/admin/job-categories');
}

/** RBAC: job_categories.manage. `slug` is immutable after this. 409 on duplicate. */
export function createJobCategory(input: CreateJobCategoryInput): Promise<AdminJobCategory> {
  return apiFetch<AdminJobCategory>('/admin/job-categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** RBAC: job_categories.manage. Names + active only (slug is not editable). */
export function updateJobCategory(
  id: string,
  input: UpdateJobCategoryInput,
): Promise<AdminJobCategory> {
  return apiFetch<AdminJobCategory>(`/admin/job-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * RBAC: job_categories.manage. Hard-delete only when unused — otherwise the API
 * returns 409 CATEGORY_IN_USE (deactivate instead) or CATEGORY_PROTECTED ('other').
 */
export function deleteJobCategory(id: string): Promise<void> {
  return apiFetch<void>(`/admin/job-categories/${id}`, { method: 'DELETE' });
}

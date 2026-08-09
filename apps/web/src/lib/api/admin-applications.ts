import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';

export type AdminApplicationRow = components['schemas']['AdminApplicationRow'];
export type AdminApplicationDetail = components['schemas']['AdminApplicationDetail'];
export type AdminTimelineEntry = components['schemas']['AdminTimelineEntry'];
export type ApplicationStatus = components['schemas']['ApplicationStatus'];
export type NoteEntry = components['schemas']['NoteEntry'];

export interface ApplicationListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort?: string;
}

export interface ApplicationListPage {
  data: AdminApplicationRow[];
  meta: ApplicationListMeta;
}

export interface ApplicationListQuery {
  status?: ApplicationStatus;
  jobId?: string;
  /** Matches the application humanId or the candidate's name. */
  search?: string;
  page?: number;
  pageSize?: number;
  /** `field:dir`; clamped server-side. */
  sort?: string;
}

/** Offset list (admin context — the ONLY context carrying overrideReason). RBAC: applications.manage. */
export function listAdminApplications(
  query: ApplicationListQuery = {},
): Promise<ApplicationListPage> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.jobId) params.set('jobId', query.jobId);
  if (query.search) params.set('search', query.search);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  // Raw fetch: the offset envelope carries `meta`, which apiFetch would discard.
  return apiFetchRaw<ApplicationListPage>(`/admin/applications${qs ? `?${qs}` : ''}`);
}

/**
 * The Screen 26 detail (0.8.1): the admin row + the FULL timeline, each entry
 * with its `overrideReason` — the record the candidate's shaped timeline
 * deliberately excludes. RBAC: applications.manage.
 */
export function getAdminApplication(id: string): Promise<AdminApplicationDetail> {
  return apiFetch<AdminApplicationDetail>(`/admin/applications/${id}`);
}

/**
 * The corrective override — ANY transition (admins are not forward-only).
 * `overrideReason` is MANDATORY (422 OVERRIDE_REASON_REQUIRED): it is written
 * to the audit log and the admin timeline, and NEVER shown to the candidate or
 * employer — they see only a neutral entry. Re-entry into SELECTED respects
 * the once-per-application WhatsApp guard: no second WhatsApp fires. RBAC:
 * applications.change_status.
 */
export function overrideApplicationStatus(
  id: string,
  status: ApplicationStatus,
  overrideReason: string,
): Promise<AdminApplicationRow> {
  return apiFetch<AdminApplicationRow>(`/admin/applications/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, overrideReason }),
  });
}

/** Internal notes — NEVER surfaced to the candidate or employer. RBAC: applications.notes. */
export function listNotes(applicationId: string): Promise<NoteEntry[]> {
  return apiFetch<NoteEntry[]>(`/admin/applications/${applicationId}/notes`);
}

export function addNote(applicationId: string, body: string): Promise<NoteEntry> {
  return apiFetch<NoteEntry>(`/admin/applications/${applicationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/** Author-or-SUPER_ADMIN only (403 NOT_NOTE_AUTHOR otherwise). */
export function deleteNote(applicationId: string, noteId: string): Promise<void> {
  return apiFetch<void>(`/admin/applications/${applicationId}/notes/${noteId}`, {
    method: 'DELETE',
  });
}

export interface ResendResult {
  resentAt: string;
  /** The honest enqueue-time answer — email_fallback when the candidate can't receive WhatsApp. */
  channel: 'whatsapp' | 'email_fallback';
}

/**
 * The manual "Selected" WhatsApp resend — the bypassGuard seam. SELECTED-only
 * (422 APPLICATION_NOT_SELECTED), reason MANDATORY (audited; a phone number
 * never is), rate-limited 3/application/24h (429 = the guardrail working, not
 * an error). `selectedNotifiedAt` is NOT rewritten — the candidate's original
 * receipt stays truthful. RBAC: applications.change_status.
 */
export function resendWhatsApp(applicationId: string, reason: string): Promise<ResendResult> {
  return apiFetch<ResendResult>(`/admin/applications/${applicationId}/resend-whatsapp`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

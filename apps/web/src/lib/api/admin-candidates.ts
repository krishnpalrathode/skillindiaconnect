import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';

export type AdminCandidateCard = components['schemas']['AdminCandidateCard'];
export type AdminCandidateDetail = components['schemas']['AdminCandidateDetail'];
export type UserStatus = components['schemas']['UserStatus'];
export type DocumentType = components['schemas']['DocumentType'];
export type DocumentUrlGrant = components['schemas']['DocumentUrlGrant'];

export interface CandidateListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CandidateListPage {
  data: AdminCandidateCard[];
  meta: CandidateListMeta;
}

export interface CandidateListQuery {
  status?: UserStatus;
  /** The candidate's own profileVisible toggle. */
  visibility?: boolean;
  /** Matches name, email, or phone — the admin CAN search by contact details. */
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Offset list. RBAC: candidates.view. Purged tombstones ARE included. */
export function listCandidates(query: CandidateListQuery = {}): Promise<CandidateListPage> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.visibility !== undefined) params.set('visibility', String(query.visibility));
  if (query.search) params.set('search', query.search);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  // Raw fetch: the offset envelope carries `meta`, which apiFetch would discard.
  return apiFetchRaw<CandidateListPage>(`/admin/candidates${qs ? `?${qs}` : ''}`);
}

/** The admin detail: card + experiences + skills + applicationCount. RBAC: candidates.view. */
export function getCandidate(id: string): Promise<AdminCandidateDetail> {
  return apiFetch<AdminCandidateDetail>(`/admin/candidates/${id}`);
}

/**
 * Mint the SHORT-EXPIRY signed URL for ONE document. Every issuance is audited
 * server-side (document.viewed naming this admin) — so it is minted when the
 * admin actually clicks View, never eagerly per row. RBAC:
 * candidates.view_documents (a separate, higher grant than candidates.view).
 * 404 = candidate unknown, purged (documents destroyed), or type not uploaded —
 * indistinguishable by design.
 */
export function getCandidateDocumentUrl(id: string, type: DocumentType): Promise<DocumentUrlGrant> {
  return apiFetch<DocumentUrlGrant>(`/admin/candidates/${id}/documents/${type}/url`);
}

/**
 * ACTIVE → SUSPENDED. `reason` is REQUIRED (audited). RBAC: candidates.edit.
 * 409 CANDIDATE_NOT_ACTIVE / CANDIDATE_PURGED are expected guard outcomes.
 */
export function suspendCandidate(id: string, reason: string): Promise<AdminCandidateCard> {
  return apiFetch<AdminCandidateCard>(`/admin/candidates/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** SUSPENDED → ACTIVE. RBAC: candidates.edit. A purged tombstone → 409 CANDIDATE_PURGED. */
export function reactivateCandidate(id: string): Promise<AdminCandidateCard> {
  return apiFetch<AdminCandidateCard>(`/admin/candidates/${id}/reactivate`, { method: 'POST' });
}

/**
 * THE IRREVERSIBLE ACTION. RBAC: candidates.delete (SUPER_ADMIN-effective —
 * seeded ON+locked for SUPER_ADMIN, locked OFF everywhere else). The server
 * rejects `confirm !== true` (422 PURGE_NOT_CONFIRMED) and an already-purged
 * target (409 CANDIDATE_ALREADY_PURGED); the UI's job is the gravity treatment
 * that ensures a human MEANT it. 202: the worker destroys the data.
 */
export function purgeCandidate(id: string, reason: string): Promise<{ purgeScheduledFor: string }> {
  return apiFetch<{ purgeScheduledFor: string }>(`/admin/candidates/${id}/purge`, {
    method: 'POST',
    body: JSON.stringify({ reason, confirm: true }),
  });
}

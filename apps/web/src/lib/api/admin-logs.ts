import type { components } from '@skillindiaconnect/shared-types';
import { apiFetchBlob, apiFetchRaw } from './client';

export type AuditLogEntry = components['schemas']['AuditLogEntry'];

/**
 * The S2-B2 module taxonomy — Screen 29's filter chips. Kept in the FE because
 * it is a UI vocabulary (the API accepts any string; these are the values the
 * writers actually use).
 */
export const LOG_MODULES = [
  'Auth',
  'Admin',
  'Candidate',
  'Employer',
  'Jobs',
  'Applications',
  'Payments',
  'Notifications',
  'Errors',
  'System',
  'Settings',
] as const;

export const LOG_STATUSES = ['SUCCESS', 'FAILED', 'BLOCKED', 'DELIVERED', 'ERROR'] as const;

/** The server's bounded default window when no date range is given (B1). */
export const DEFAULT_WINDOW_DAYS = 30;

export interface LogQuery {
  module?: string;
  action?: string;
  actorId?: string;
  targetId?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface LogPage {
  data: AuditLogEntry[];
  nextCursor: string | null;
}

function toParams(query: LogQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params;
}

/**
 * KEYSET-paged, newest first ({ data, nextCursor } — raw fetch so the cursor
 * survives). RBAC: logs.view. When from/to are absent the SERVER applies the
 * last-30-days window — the UI must disclose that, or an admin concludes older
 * logs don't exist.
 */
export function listLogs(query: LogQuery = {}): Promise<LogPage> {
  const qs = toParams(query).toString();
  return apiFetchRaw<LogPage>(`/admin/logs${qs ? `?${qs}` : ''}`);
}

/**
 * Bulk CSV extraction of the trail. RBAC: logs.export — a SEPARATE, higher key
 * than logs.view (a MODERATOR reads pages on screen but never walks out with
 * the table). Server-capped (10k rows / 90 days → 422 EXPORT_TOO_LARGE with the
 * caps in meta), and the export itself writes an audit row — tell the admin.
 */
export function exportLogs(query: LogQuery = {}): Promise<{ blob: Blob; filename: string | null }> {
  const params = toParams(query);
  params.delete('cursor'); // pagination describes the screen, not the selection
  params.delete('limit');
  const qs = params.toString();
  return apiFetchBlob(`/admin/logs/export${qs ? `?${qs}` : ''}`);
}

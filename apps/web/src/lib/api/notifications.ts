import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch, apiFetchRaw } from './client';

type Notification = components['schemas']['Notification'];

export interface NotificationListParams {
  filter?: 'applications' | 'jobs' | 'profile' | 'system';
  unread?: boolean;
  cursor?: string;
  limit?: number;
}

export interface NotificationListResponse {
  data: Notification[];
  nextCursor: string | null;
}

/**
 * Notifications are per-user and the API is the same shape for every audience —
 * only the base path differs (`/candidates/me/…` vs `/employers/me/…`). Build a
 * client bound to a base path so the shared <NotificationList> can serve both.
 */
export function buildNotificationsApi(base: string) {
  return {
    listNotifications(params: NotificationListParams = {}): Promise<NotificationListResponse> {
      const q = new URLSearchParams();
      if (params.filter) q.set('filter', params.filter);
      if (params.unread) q.set('unread', 'true');
      if (params.cursor) q.set('cursor', params.cursor);
      if (params.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return apiFetchRaw<NotificationListResponse>(`${base}${qs ? `?${qs}` : ''}`);
    },
    markNotificationsRead(ids: string[]): Promise<{ markedCount: number }> {
      return apiFetch<{ markedCount: number }>(`${base}/read`, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    },
    markAllNotificationsRead(): Promise<{ markedCount: number }> {
      return apiFetch<{ markedCount: number }>(`${base}/read`, {
        method: 'POST',
        body: JSON.stringify({ all: true }),
      });
    },
  };
}

export type NotificationsApi = ReturnType<typeof buildNotificationsApi>;

export const candidateNotificationsApi = buildNotificationsApi('/candidates/me/notifications');
export const employerNotificationsApi = buildNotificationsApi('/employers/me/notifications');

// Back-compat named exports (candidate feed) — existing callers keep working.
export const listNotifications = candidateNotificationsApi.listNotifications;
export const markNotificationsRead = candidateNotificationsApi.markNotificationsRead;
export const markAllNotificationsRead = candidateNotificationsApi.markAllNotificationsRead;

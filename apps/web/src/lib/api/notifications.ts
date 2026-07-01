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

export function listNotifications(
  params: NotificationListParams = {},
): Promise<NotificationListResponse> {
  const q = new URLSearchParams();
  if (params.filter) q.set('filter', params.filter);
  if (params.unread) q.set('unread', 'true');
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiFetchRaw<NotificationListResponse>(`/candidates/me/notifications${qs ? `?${qs}` : ''}`);
}

export function markNotificationsRead(ids: string[]): Promise<{ markedCount: number }> {
  return apiFetch<{ markedCount: number }>('/candidates/me/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export function markAllNotificationsRead(): Promise<{ markedCount: number }> {
  return apiFetch<{ markedCount: number }>('/candidates/me/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });
}

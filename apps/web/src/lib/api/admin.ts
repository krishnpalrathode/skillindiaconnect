import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';

export type AdminMe = components['schemas']['AdminMe'];
export type PermissionKey = components['schemas']['PermissionKey'];

/**
 * The console's navigation source. Returns what the caller ACTUALLY holds — the
 * client never derives permissions from the role name, because Screen 27 changes
 * grants at runtime and a role→capability map would silently go stale.
 */
export function getAdminMe(): Promise<AdminMe> {
  return apiFetch<AdminMe>('/admin/me/permissions');
}

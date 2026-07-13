import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';

export type Setting = components['schemas']['Setting'];

/**
 * Screen 28's tab groups, derived from the setting key's PREFIX — the server
 * returns a flat list and deliberately carries no grouping/label metadata
 * (presentation is client i18n; see the contract's Setting description).
 * Order here is render order.
 */
export const SETTING_GROUPS = ['worker_protection', 'jobs', 'candidates', 'payments'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export function groupOf(setting: Setting): SettingGroup | 'other' {
  const prefix = setting.key.split('.')[0] as SettingGroup;
  return SETTING_GROUPS.includes(prefix) ? prefix : 'other';
}

/** RBAC: settings.view. Flat list, ordered by key. */
export function getSettings(): Promise<Setting[]> {
  return apiFetch<Setting[]>('/admin/settings');
}

/**
 * RBAC: settings.manage; core rules additionally require SUPER_ADMIN
 * (403 CORE_RULE_FORBIDDEN per key). Batch-atomic server-side — but Screen 28
 * saves PER ROW (one key per call), so a failed save is unambiguous about which
 * setting it concerned.
 */
export function updateSetting(key: string, value: unknown): Promise<Setting[]> {
  return apiFetch<Setting[]>('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify({ updates: [{ key, value }] }),
  });
}

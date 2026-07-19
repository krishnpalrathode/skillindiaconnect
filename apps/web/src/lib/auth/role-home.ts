import type { components } from '@skillindiaconnect/shared-types';

type Role = components['schemas']['UserSummary']['role'];

const ADMIN_ROLES: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT'];

/**
 * The landing route for a role. Every post-login redirect and wrong-role
 * guard bounce must go through this — routing a non-candidate to a
 * candidate page (or vice versa) creates guard→guard redirect loops.
 */
export function roleHome(role: Role, locale?: string): string {
  const prefix = locale ? `/${locale}` : '';
  if (ADMIN_ROLES.includes(role)) return `${prefix}/admin/dashboard`;
  if (role === 'EMPLOYER') return `${prefix}/employer/dashboard`;
  return `${prefix}/dashboard`;
}

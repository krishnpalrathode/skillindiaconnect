import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from './client';
import type { PermissionKey } from './admin';

export type RbacMatrix = components['schemas']['RbacMatrix'];
export type RbacCell = components['schemas']['RbacCell'];
export type UserRole = components['schemas']['UserRole'];

/** The full roles × permissions grid. RBAC: roles.view. */
export function getMatrix(): Promise<RbacMatrix> {
  return apiFetch<RbacMatrix>('/admin/roles/matrix');
}

/**
 * Flip ONE cell. RBAC: roles.manage (SUPER_ADMIN-effective in the shipped seed).
 * The expected non-200 answers are part of the contract, not failures:
 *   423 PERMISSION_CELL_LOCKED   — the cell is immutable (SUPER_ADMIN column /
 *                                  seeded locked set); render calmly, revert.
 *   422 SELF_LOCKOUT_FORBIDDEN   — you can't revoke your own roles.manage.
 *   422 LAST_MANAGER_FORBIDDEN   — the final manager can't lose it.
 * These are guardrails working. Callers refetch the matrix after a 200 — this
 * grid is security-critical, so it renders what the server says, never an
 * optimistic guess.
 */
export function updateCell(
  role: UserRole,
  permission: PermissionKey,
  enabled: boolean,
): Promise<RbacCell> {
  return apiFetch<RbacCell>('/admin/roles/matrix', {
    method: 'PATCH',
    body: JSON.stringify({ role, permission, enabled }),
  });
}

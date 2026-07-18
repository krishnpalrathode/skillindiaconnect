import { UserRole } from '@prisma/client';

/**
 * The matrix COLUMNS, in render order (Screen 27).
 *
 * Only admin-side roles. CANDIDATE and EMPLOYER are not admin-console roles —
 * they hold no `role_permissions` rows, are never rendered as columns, and are
 * rejected by UpdateCellDto. Their capabilities come from ownership checks
 * (this is MY profile / MY company), not from the RBAC matrix.
 */
export const MATRIX_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MODERATOR,
  UserRole.SUPPORT,
];

/**
 * THE single source of cell lockedness. Both the READ path (which renders
 * `locked` on every cell) and the WRITE path (which rejects a locked cell with
 * 423) call THIS function — there is no second copy of the rule, so the flag the
 * FE greys out and the flag the server enforces can never disagree.
 *
 * Lockedness has exactly two components:
 *
 * 1. THE SUPER_ADMIN COLUMN — a CODE invariant, not a data one. Deliberately not
 *    read from `isLocked`: if lockedness of the super-admin column lived only in
 *    a DB column, one bad migration, one careless seed edit, or one UPDATE in a
 *    psql session could make the platform permanently unadministrable — there
 *    would be no role left that can grant roles back. So the last-administrator
 *    protection is asserted in code, where changing it requires a reviewed diff.
 *    It is never configurable.
 *
 * 2. `role_permissions.isLocked` — the SEEDED locked set (e.g. billing.manage,
 *    subscriptions.manage, admin_users.manage are locked-OFF for every non-super
 *    role). This one IS data: it is a product decision the seed owns, and the
 *    seed is its single source.
 */
export function isCellLocked(role: UserRole, row: { isLocked: boolean }): boolean {
  return role === UserRole.SUPER_ADMIN || row.isLocked;
}

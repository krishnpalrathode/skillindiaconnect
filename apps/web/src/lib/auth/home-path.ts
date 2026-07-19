/**
 * Where a signed-in user belongs, by role.
 *
 * THE BUG THIS FIXES: the login page sent every successful sign-in to
 * `/dashboard` — the CANDIDATE dashboard — regardless of role. An admin
 * therefore landed on a candidate screen, whose guard bounced any
 * non-candidate to `/employer/onboarding`, stranding a SUPER_ADMIN on an
 * employer registration form. The admin console was reachable the whole time;
 * nothing ever routed anyone to it.
 *
 * The guards on candidate/employer screens had the same defect from the other
 * side: they all redirected "not my role" to `/employer/onboarding`, which is
 * only the right destination for an EMPLOYER. For an admin it is simply wrong,
 * and for a candidate-shaped URL it produced a bounce the user experienced as
 * the page reloading over and over.
 *
 * One function, used by both the login redirect and every role guard, so the
 * two can never disagree about where a role lives.
 */
import type { Locale } from '@/i18n/routing';

/** Roles that belong in the admin console (they share one home). */
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT']);

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.has(role);
}

/**
 * The home screen for `role`, locale-prefixed.
 *
 * Unknown/absent role falls back to the candidate dashboard — the same
 * behaviour as before for the only case it was ever correct for.
 */
export function homePathForRole(role: string | null | undefined, locale: Locale | string): string {
  const base = `/${locale}`;
  if (isAdminRole(role)) return `${base}/admin/dashboard`;
  if (role === 'EMPLOYER') return `${base}/employer/dashboard`;
  return `${base}/dashboard`;
}

import type { PermissionKey } from '@/lib/api/admin';

/**
 * THE nav ↔ permission map. This is DATA, not logic.
 *
 * The console's sidebar is rendered by filtering this list through the caller's
 * effective permission set (`useAdmin().has`). It is NOT a role→items map, and
 * that distinction is the whole point of the unit:
 *
 *   Screen 27 lets a Super Admin grant or revoke a permission at RUNTIME. If the
 *   nav were keyed on the ROLE, granting `logs.view` to MODERATOR would change
 *   what a moderator CAN do without changing what they SEE. The two would drift,
 *   someone would "fix" it by hardcoding more role checks, and the RBAC editor
 *   would quietly become decorative.
 *
 * So: grant a permission, and its nav item appears on the next load. No code
 * change, no deploy, no role check anywhere.
 *
 * `permission: null` means "any admin-side role sees this" — only the Dashboard,
 * which is the console's landing page and must never be un-navigable (a caller
 * with an empty permission set still needs somewhere to land).
 *
 * REMINDER: this is UX. Hiding an item is a courtesy; the server's 403 is the
 * control. Every screen behind these links survives a forced URL — see
 * ForbiddenState.
 */
export interface AdminNavItem {
  /** Path segment under /{locale}/admin — also the i18n key suffix. */
  key: string;
  /** The permission that reveals it. `null` = always visible to admin roles. */
  permission: PermissionKey | null;
  /** Lucide icon name, resolved in AdminSidebar (keeps this file data-only). */
  icon: string;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: 'dashboard', permission: null, icon: 'LayoutDashboard' },
  { key: 'employers', permission: 'employers.view', icon: 'Building2' },
  { key: 'candidates', permission: 'candidates.view', icon: 'Users' },
  { key: 'jobs', permission: 'jobs.view', icon: 'Briefcase' },
  // `applications.manage` — the key that actually gates GET /admin/applications.
  // A nav item must map to the permission guarding its screen's PRIMARY data
  // call, or the link renders and then immediately 403s, which is worse than not
  // offering it. (Consequence worth flagging: MODERATOR holds applications.notes
  // but not applications.manage, so they cannot reach an application to note it —
  // a dead grant in the seed, and a backend question, not a nav workaround.)
  { key: 'applications', permission: 'applications.manage', icon: 'FileText' },
  { key: 'logs', permission: 'logs.view', icon: 'ScrollText' },
  { key: 'roles', permission: 'roles.view', icon: 'ShieldCheck' },
  // `settings.view`, added in S6a-F1. S2-B1 had gated /admin/settings on
  // `logs.view` as an explicit placeholder — but a MODERATOR holds logs.view, so
  // that key would both show them the Settings item AND let the server serve it.
  // Read gates the link; `settings.manage` gates the save button inside (F2).
  { key: 'settings', permission: 'settings.view', icon: 'Settings' },
] as const;

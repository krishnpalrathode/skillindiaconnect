export const Permission = {
  CANDIDATES_VIEW: 'candidates.view',
  CANDIDATES_EDIT: 'candidates.edit',
  CANDIDATES_DELETE: 'candidates.delete',
  CANDIDATES_ONBOARD_MANUAL: 'candidates.onboard_manual',
  CANDIDATES_EXPORT: 'candidates.export',
  // S6a-B1: admins may read candidate DOCUMENTS (decision 5). A separate key
  // from candidates.view because it is the DPDP who-saw-whose-passport surface —
  // every grant is audited, and that audit is what makes the invisible-candidate
  // relaxation defensible.
  CANDIDATES_VIEW_DOCUMENTS: 'candidates.view_documents',
  EMPLOYERS_VIEW: 'employers.view',
  EMPLOYERS_APPROVE_REJECT: 'employers.approve_reject',
  EMPLOYERS_SUSPEND: 'employers.suspend',
  EMPLOYERS_DELETE: 'employers.delete',
  JOBS_VIEW: 'jobs.view',
  JOBS_POST_ADMIN: 'jobs.post_admin',
  JOBS_ARCHIVE: 'jobs.archive',
  // S6a-B2: approve/reject a PENDING_REVIEW job. Distinct from jobs.archive
  // (which ends a live job) — moderation is the gate INTO the live set.
  JOBS_MODERATE: 'jobs.moderate',
  APPLICATIONS_MANAGE: 'applications.manage',
  APPLICATIONS_CHANGE_STATUS: 'applications.change_status',
  APPLICATIONS_NOTES: 'applications.notes',
  REPORTS_VIEW: 'reports.view',
  LOGS_VIEW: 'logs.view',
  // S6a-B1: bulk extraction of the audit trail is a SEPARATE, higher grant than
  // reading a page of it on screen. A MODERATOR holds logs.view but NOT this —
  // reading the log and walking out with the whole table are different acts.
  LOGS_EXPORT: 'logs.export',
  BILLING_MANAGE: 'billing.manage',
  SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',
  ADMIN_USERS_MANAGE: 'admin_users.manage',
  // S6a-B2: the RBAC matrix itself (Screen 27). READ and WRITE are separate keys
  // for the same reason logs.view/logs.export are: seeing who can do what is a
  // far smaller grant than changing it. ROLES_MANAGE is SUPER_ADMIN-effective —
  // seeded ON+locked for SUPER_ADMIN, locked OFF everywhere else — so in the
  // shipped matrix only a SUPER_ADMIN can alter permissions at all.
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

/**
 * THE canonical permission list AND its render order.
 *
 * Declaration order above is grouped by module (candidates → employers → jobs →
 * applications → reports → logs → billing/subscriptions/admin_users → roles), so
 * Screen 27 renders its rows by iterating this array — there is no second
 * ordering table to drift from the keys themselves.
 *
 * Adding a key is a CODE + SEED change, never a runtime one: the matrix API
 * flips existing cells, it does not create them. A new key means editing this
 * file, bumping the seed's count assertion, and re-seeding.
 */
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = Object.values(Permission);

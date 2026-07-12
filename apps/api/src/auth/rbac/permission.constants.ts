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
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

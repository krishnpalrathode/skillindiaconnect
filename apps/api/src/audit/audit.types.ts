import { AuditStatus, UserRole } from '@prisma/client';

export { AuditStatus };

/**
 * Canonical module names — match Screen 29's filter chip taxonomy.
 * Add here when a new domain module is introduced; keep in sync with the UI filter list.
 */
export const AUDIT_MODULES = {
  AUTH: 'Auth',
  ADMIN: 'Admin',
  CANDIDATE: 'Candidate',
  EMPLOYER: 'Employer',
  JOBS: 'Jobs',
  PAYMENTS: 'Payments',
  NOTIFICATIONS: 'Notifications',
  ERRORS: 'Errors',
  SYSTEM: 'System',
  SETTINGS: 'Settings',
} as const;

export type AuditModuleName = (typeof AUDIT_MODULES)[keyof typeof AUDIT_MODULES];

/** Dot-namespaced action strings — <domain>.<verb>. */
export const AUDIT_ACTIONS = {
  // Settings (S2-B1)
  SETTINGS_UPDATE: 'settings.update',
  // Candidate documents (S1-3)
  DOCUMENT_CHANGED: 'document.changed',
  // Account (S1-3)
  ACCOUNT_DELETION_REQUESTED: 'account.deletion_requested',
  // Employer (S2-B4 — stubs only until that sprint lands)
  EMPLOYER_APPROVED: 'employer.approved',
  EMPLOYER_REJECTED: 'employer.rejected',
  EMPLOYER_SUSPENDED: 'employer.suspended',
  // Jobs (S2-B5)
  JOB_CREATED: 'job.created',
  JOB_UPDATED: 'job.updated',
  JOB_PUBLISHED: 'job.published',
  JOB_PUBLISH_BLOCKED: 'job.publish.blocked',
  JOB_PAUSED: 'job.paused',
  JOB_RESUMED: 'job.resumed',
  JOB_ARCHIVED: 'job.archived',
  JOB_AUTO_ARCHIVED: 'job.auto_archived',
  JOB_DUPLICATED: 'job.duplicated',
  // Applications (S4)
  APPLICATION_STATUS_CHANGED: 'application.status.changed',
  APPLICATION_ADMIN_OVERRIDE: 'application.admin_override',
  // Payments (S5)
  PAYMENT_CAPTURED: 'payment.captured',
  WEBHOOK_RECEIVED: 'webhook.received',
  // Notifications (S2-B3)
  NOTIFICATION_DELIVERED: 'notification.delivered',
  NOTIFICATION_FAILED: 'notification.failed',
} as const;

export type AuditActionName = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * The entry shape passed to AuditService.log() and logInTransaction().
 * `actorRole` mirrors the Prisma UserRole enum — passed through from the JWT payload.
 */
export interface AuditEntry {
  actorUserId?: string;
  actorRole?: UserRole;
  action: string;
  module: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  status: AuditStatus;
  meta?: Record<string, unknown>;
}

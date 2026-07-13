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
  APPLICATIONS: 'Applications',
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
  EMPLOYER_REGISTERED: 'employer.registered',
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
  APPLICATION_CREATED: 'application.created',
  APPLICATION_STATUS_CHANGED: 'application.status.changed',
  APPLICATION_ADMIN_OVERRIDE: 'application.admin_override',
  // Payments (S5)
  CHECKOUT_CREATED: 'checkout.created',
  CHECKOUT_FAILED: 'checkout.failed',
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_REFUNDED: 'payment.refunded',
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_REJECTED: 'webhook.rejected',
  WEBHOOK_DUPLICATE: 'webhook.duplicate',
  WEBHOOK_NOOP: 'webhook.noop',
  WEBHOOK_STALE_IGNORED: 'webhook.stale_ignored',
  WEBHOOK_UNKNOWN_ORDER: 'webhook.unknown_order',
  // Notifications (S2-B3)
  NOTIFICATION_DELIVERED: 'notification.delivered',
  NOTIFICATION_FAILED: 'notification.failed',
  // Employer profile (S3-B1)
  EMPLOYER_PROFILE_UPDATED: 'employer.profile.updated',
  EMPLOYER_LOGO_CONFIRMED: 'employer.logo.confirmed',
  EMPLOYER_CONTACT_CREATED: 'employer.contact.created',
  EMPLOYER_CONTACT_UPDATED: 'employer.contact.updated',
  EMPLOYER_CONTACT_DELETED: 'employer.contact.deleted',
  // Passport expiry cron (S3-B3)
  PASSPORT_EXPIRY_RUN: 'passport_expiry.run',
  // Subscription lifecycle (S5-B3)
  SUBSCRIPTION_GRACE_STARTED: 'subscription.grace_started',
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
  SUBSCRIPTION_LIFECYCLE_RUN: 'subscription_lifecycle.run',
  // Pro document gate (S5-B3) — the DPDP who-saw-whose-passport trail.
  // REUSED by S6a-B1's admin grants (employer certs + candidate documents):
  // one action, one meaning — "someone was granted sight of a document".
  DOCUMENT_VIEWED: 'document.viewed',
  // Audit-trail read side (S6a-B1). The export records ITSELF — bulk extraction
  // of the trail is exactly the kind of event the trail exists to record.
  AUDIT_EXPORTED: 'audit.exported',
  // RBAC matrix (S6a-B2). Who flipped which cell, from what to what. Written
  // TRANSACTIONALLY with the grant — a permission change without an audit row is
  // the one event this trail may never miss.
  RBAC_PERMISSION_CHANGED: 'rbac.permission.changed',
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

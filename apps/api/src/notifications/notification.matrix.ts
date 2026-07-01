import { NotificationType, WaMessageKind } from '@prisma/client';

export interface MatrixEntry {
  /** Write a row to the `notifications` table (candidate in-app feed). */
  inApp: boolean;
  /** Enqueue a WhatsApp job; requires `whatsappCapable = true` at send time. */
  whatsapp: boolean;
  /** Meta WhatsApp Business template key. Required when whatsapp = true. */
  whatsappTemplate?: string;
  /** WaMessageKind for the whatsapp_messages row. Defaults to STATUS_UPDATE. */
  whatsappKind?: WaMessageKind;
  /** Enqueue an email job. */
  email: boolean;
}

/**
 * Phase-1 §6 notification matrix — the SINGLE authoritative table.
 *
 * The fan-out engine reads ONLY this table; no per-type conditionals exist in
 * notification.service.ts or the processor. Changing a channel for any type is
 * a ONE-LINE data edit here, guarded by notification.matrix.spec.ts.
 */
export const NOTIFICATION_MATRIX: Record<NotificationType, MatrixEntry> = {
  // ── Application events ───────────────────────────────────────────────────────
  APPLICATION_SELECTED: {
    inApp: true,
    whatsapp: true,
    whatsappTemplate: 'wa.selected',
    whatsappKind: WaMessageKind.STATUS_UPDATE,
    email: true,
  },
  APPLICATION_SHORTLISTED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  APPLICATION_REJECTED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Job discovery ─────────────────────────────────────────────────────────────
  NEW_JOB_MATCH: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  JOB_CLOSING_SOON: {
    inApp: true,
    whatsapp: false,
    email: false,
  },
  // ── Profile / compliance reminders ────────────────────────────────────────────
  PROFILE_REMINDER: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  PASSPORT_EXPIRY: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  PROFILE_VIEWED: {
    inApp: true,
    whatsapp: false,
    email: false,
  },
  // ── Employer lifecycle ────────────────────────────────────────────────────────
  EMPLOYER_APPROVED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  EMPLOYER_REJECTED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  EMPLOYER_SUSPENDED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Subscriptions ─────────────────────────────────────────────────────────────
  SUBSCRIPTION_PURCHASED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  SUBSCRIPTION_EXPIRING: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  SUBSCRIPTION_EXPIRED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Candidate/employer matching ───────────────────────────────────────────────
  // Spec: "whatsapp/email (open item)" — email chosen for MVP; WhatsApp opted-in when
  // the CANDIDATE_MATCHES template is approved.
  CANDIDATE_MATCHES: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Resume delivery (CR-001) ──────────────────────────────────────────────────
  // The resume send itself is the WA message; in-app receipt confirms delivery.
  // Actual trigger lives in S7 (resume flow); the matrix entry + channel exist now.
  RESUME_SENT: {
    inApp: true,
    whatsapp: true,
    whatsappTemplate: 'wa.resume_doc',
    whatsappKind: WaMessageKind.RESUME_DOCUMENT,
    email: false,
  },
};

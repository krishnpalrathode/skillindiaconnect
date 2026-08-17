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
  /**
   * SECURITY/TRANSACTIONAL mail — sends even when the recipient has turned off
   * email notifications (`candidate_profiles.emailNotifs = false`).
   *
   * That toggle governs NOTIFICATIONS (job matches, reminders, status updates).
   * It must not be able to suppress a message the user just asked for as part of
   * getting into their own account: silently dropping a password-reset link
   * locks them out with no feedback, and the opt-out was never consent to that.
   * Deliberately opt-in per type — default false keeps every existing type
   * honouring the preference exactly as before.
   */
  transactional?: boolean;
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
  /*
    ── Admin-directed ─────────────────────────────────────────────────────────
    An employer proposed a slot for a verification call.

    Email as well as in-app, and deliberately so: the point of the feature is
    that a human turns up at a specific time, and an in-app row is only seen by
    an admin who happens to be looking at the console. WhatsApp is off — staff
    are not on the WhatsApp tier, which is candidate-facing.
  */
  VERIFICATION_CALL_REQUESTED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Job moderation outcomes (S6b-B2 — employer-facing) ───────────────────────
  JOB_APPROVED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  JOB_REJECTED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  JOB_POSTED_ONBEHALF: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Job discovery ─────────────────────────────────────────────────────────────
  /**
   * Profile-completion job-match alert (top 3 matches + a link to all of them).
   *
   * `whatsapp` is FALSE only because `job_match_alert` is not yet approved in
   * WhatsApp Manager — `assertTemplateMappingComplete` would crash the worker at
   * boot otherwise, which is the intended behaviour, not a bug to route around.
   * The template key below is already wired and the producer
   * (candidate/match-alert.processor.ts) already supplies templateVars, so
   * enabling WhatsApp is exactly this one `false` → `true`.
   */
  NEW_JOB_MATCH: {
    inApp: true,
    whatsapp: false,
    whatsappTemplate: 'wa.job_match',
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
  /**
   * Employer outreach: "<Company> is interested in your profile."
   *
   * WhatsApp-tier by intent — this is the message the employer is choosing to
   * pay to send — but `whatsapp` stays FALSE until `employer_interest_notice` is
   * approved in WhatsApp Manager, for the same reason as NEW_JOB_MATCH above:
   * assertTemplateMappingComplete would otherwise crash the worker at boot.
   * The producer already supplies templateVars, so enabling it is this one line.
   */
  EMPLOYER_INTERESTED: {
    inApp: true,
    whatsapp: false,
    whatsappTemplate: 'wa.employer_interest',
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
  // S7-B2: the render finished. IN-APP ONLY, deliberately: the candidate is
  // normally sitting on the poll screen and sees it immediately; the feed row
  // exists for the one who navigated away. An email saying "your PDF is ready"
  // (when they must return to the app to do anything with it anyway) is noise
  // on a channel we ask workers to trust for things that matter.
  RESUME_READY: {
    inApp: true,
    whatsapp: false,
    email: false,
  },
  // ── Setup confirmations ──────────────────────────────────────────────────────
  // In-app AND email, no WhatsApp. Email because this is the receipt for work the
  // person just finished and may want to find again days later; a feed row alone
  // is gone the moment they close the tab. Not WhatsApp: the template tier is
  // reserved for things that need reaching someone away from the app — an offer,
  // a document, an expiring passport — and spending it on "you're set up" is how
  // a channel workers currently trust becomes one they mute.
  CANDIDATE_PROFILE_COMPLETE: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  EMPLOYER_REGISTERED: {
    inApp: true,
    whatsapp: false,
    email: true,
  },
  // ── Account security ─────────────────────────────────────────────────────────
  // EMAIL ONLY, and deliberately so. No in-app row: the recipient cannot sign in
  // to read one, and writing "a password reset was requested" into the feed
  // would surface the event to any session already open on that account. No
  // WhatsApp: the reset link is a bearer credential and the phone on file is not
  // proven to be the same person's.
  PASSWORD_RESET: {
    inApp: false,
    whatsapp: false,
    email: true,
    transactional: true,
  },
};

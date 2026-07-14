import { Prisma } from '@prisma/client';

/**
 * THE FIELD-BY-FIELD ERASURE MAP (S6b-B1 — DPDP right to erasure).
 *
 * This file is the reviewable specification of what a purge destroys, scrubs,
 * tombstones, and deliberately KEEPS. PurgeService executes exactly this map and
 * nothing else; `anonymize.constants.spec.ts` walks Prisma's DMMF and fails the
 * build if a column is added to the candidate surface without being classified
 * here — a new PII column can never silently survive a purge.
 *
 * PURGE IS ANONYMIZATION, NOT ROW DELETION. The users and candidate_profiles
 * rows SURVIVE, tombstoned, so applications, timelines, financial records and
 * audit rows keep their foreign keys — deleting the rows would cascade-destroy
 * the employer's historical hiring records. The PERSONAL DATA goes; the
 * anonymized fact that "an account existed and applied" may remain.
 *
 * PURGE IS IRREVERSIBLE. There is no undo, no restore, no re-activation
 * (`/reactivate` returns 409 CANDIDATE_PURGED). `purgedAt` is never cleared.
 *
 * Employers are NOT purged: companies are not natural persons under the DPDP
 * Act, so there is no employer equivalent of this map (deliberate — see the
 * unit's scope note).
 */

/** The tombstone display name — matches the frozen contract's AdminCandidateCard. */
export const PURGED_FULL_NAME = 'Deleted user';

/**
 * Non-reversible, collision-free, non-routable email tombstone.
 * - Collision-free: userId is unique, so the value satisfies the unique index.
 * - Non-routable: `.invalid` is RFC 2606-reserved and can never receive mail.
 * - Matches the mock fixture's scheme (`purged-{userId}@deleted.invalid`).
 */
export function purgedEmail(userId: string): string {
  return `purged-${userId}@deleted.invalid`;
}

/** Scrub values for delivery-log rows that survive with their aggregates. */
export const REDACTED_PHONE = 'REDACTED';
export const REDACTED_EMAIL = 'redacted@deleted.invalid';

/**
 * users — anonymized IN PLACE. `status` stays PENDING_DELETION (the contract's
 * UserStatus enum has no PURGED value); `purgedAt` is the terminal marker.
 */
export function userAnonymizedFields(
  userId: string,
  now: Date,
): Prisma.UserUncheckedUpdateInput {
  return {
    email: purgedEmail(userId),
    passwordHash: null, // no credential survives; login is impossible
    googleId: null, //     OAuth link severed
    lastLoginAt: null,
    termsAcceptedAt: null,
    deletionDueAt: null, // the grace window is consumed
    purgedAt: now,
  };
}

/** users — fields that survive the purge, and why. */
export const USER_KEPT_FIELDS: Record<string, string> = {
  id: 'the tombstone anchor — FKs from applications/audit stay valid',
  role: 'not PII; admin lists still group by role',
  status: 'stays PENDING_DELETION — purgedAt is the terminal marker',
  createdAt: 'membership date, needed by the admin card; not identifying alone',
  updatedAt: 'Prisma-managed',
};

/**
 * candidate_profiles — every PII field nulled/zeroed IN PLACE. The row survives
 * (tombstone) so the admin list can still show that a candidate existed.
 */
export const CANDIDATE_PROFILE_ANONYMIZED_FIELDS = {
  fullName: PURGED_FULL_NAME,
  fatherName: null,
  dob: null,
  phone: null,
  phoneVerifiedAt: null,
  whatsappCapable: false,
  maritalStatus: null,
  religion: null,
  languages: [] as string[],
  jobCategoryId: null,
  photoKey: null, // R2 object destroyed by the worker (captured first)
  currentLocation: null,
  nationality: null,
  noticePeriod: null,
  salaryExpectationMin: null,
  salaryExpectationMax: null,
  salaryExpectationCurrency: null,
  isAvailable: false,
  profileVisible: false, // never appears in employer browse again
  showPhone: false,
  showReligion: false,
  waNotifications: false,
  emailNotifs: false,
  completionPct: 0,
  videoR2Key: null, // R2 object destroyed by the worker (captured first)
  videoDurationSec: null,
  videoSizeBytes: null,
  videoUploadedAt: null,
} satisfies Prisma.CandidateProfileUncheckedUpdateInput;

/** candidate_profiles — fields that survive, and why. */
export const CANDIDATE_PROFILE_KEPT_FIELDS: Record<string, string> = {
  id: 'the tombstone anchor',
  userId: 'links the tombstone pair',
  createdAt: 'membership date on the admin card',
  updatedAt: 'Prisma-managed',
};

/**
 * Tables whose rows for the purged user are DELETED outright. None of these
 * carries a foreign key any other module's records depend on — deleting them
 * destroys PII without orphaning anything.
 */
export const DELETED_TABLES = [
  'refresh_sessions', //   ip + userAgent are PII; also revokes every session
  'otp_challenges', //     keyed by phone (deleted by userId AND by captured phone)
  'notifications', //      bodies contain names, job titles, company names
  'saved_jobs', //         behavioral data (what the person was looking for)
  'candidate_resumes', //  render settings + lastRenderKey (R2 object destroyed)
  'resume_generations', // generated PDFs ARE the profile (R2 objects destroyed)
  'candidate_documents', // passport numbers/expiries live here (R2 destroyed)
  'work_experiences', //   company names/roles/countries; no cross-module FK → DELETE
  'candidate_skills', //   no cross-module FK → DELETE
] as const;

/**
 * applications — KEPT and TOMBSTONED, never deleted: the employer's record that
 * "an application happened" survives, anonymized. S4-B3's applicant mapper was
 * built for exactly this null-candidate shape.
 */
export function applicationTombstoneFields(now: Date): Prisma.ApplicationUncheckedUpdateInput {
  return {
    candidateId: null, //         the link becomes a tombstone (S4-B3 renders it)
    candidateTombstone: { purged: true, at: now.toISOString() }, // PII-free marker
    coverLetter: null, //         candidate-authored free text
    rejectionFeedback: null, //   free text addressed to a person who no longer exists
    // status, matchScore, matchBreakdown, docs counts, timeline: all KEPT —
    // they are the employer's hiring record and contain no direct identifiers.
  };
}

/**
 * Delivery logs — SCRUBBED, not deleted: kind/status aggregates survive for ops,
 * but the address columns (the PII) are overwritten.
 */
export const SCRUBBED_TABLES: Record<string, string> = {
  whatsapp_messages: `phone → "${REDACTED_PHONE}"`,
  email_messages: `toEmail → "${REDACTED_EMAIL}"`,
};

/**
 * Tables deliberately KEPT untouched, and why.
 * - profile_views: candidateId now points at a tombstone; the row itself is
 *   (candidateId, companyId, timestamp) — no PII — and employers' view
 *   aggregates keep their integrity. (Stated choice: KEEP.)
 * - audit_logs: APPEND-ONLY, already PII-free at write time (S2-B2 redaction).
 *   The trail records that the account existed and was purged — that IS the
 *   compliance evidence. The purge never modifies it.
 * - application_timeline / application_notes: status transitions and
 *   admin-authored notes keyed by actor ids — the employer/admin record.
 */
export const KEPT_TABLES = [
  'profile_views',
  'audit_logs',
  'application_timeline',
  'application_notes',
] as const;

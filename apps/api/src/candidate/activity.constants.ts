/**
 * Candidate activity — how recently they actually used the platform.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * An employer scanning a candidate list has no way to tell a profile written
 * last week from one abandoned eight months ago. Both look identical, both say
 * "available", and only one of them will answer the phone. That wasted call is
 * the problem this measures.
 *
 * ── What "active" means here ───────────────────────────────────────────────
 * `users.lastLoginAt`, which the auth module writes on password login, OTP
 * login, and (throttled) on refresh-token rotation. It is therefore "last time
 * we saw them", not "last time they typed a password" — which is the honest
 * reading for someone whose session stays alive on a phone for weeks.
 *
 * ── Why the buckets are coarse ─────────────────────────────────────────────
 * An employer needs to decide whether to call; they do not need a candidate's
 * login timestamp, which is behavioural data about a person's daily routine and
 * none of a stranger's business. Three buckets answer the question and leak
 * nothing finer.
 */
export const ACTIVITY = {
  /** Seen within a week — the profile is live. */
  ACTIVE_WITHIN_DAYS: 7,
  /** Seen within a month — probably still looking, worth a call. */
  RECENT_WITHIN_DAYS: 30,
} as const;

/**
 * Days of silence before we email to ask whether they are still looking.
 *
 * The same 30 days as the RECENT boundary on purpose: the moment a candidate
 * stops counting as recently-active to employers is exactly the moment it is
 * worth asking them, because that is when their profile starts losing value.
 */
export const INACTIVITY_NUDGE_DAYS = 30;

/**
 * How stale `lastLoginAt` must be before a token refresh bothers to rewrite it.
 *
 * A refresh happens every few minutes for an open app; writing the row each
 * time would turn a read-heavy auth path into a write-heavy one for a value
 * measured in DAYS. Twelve hours keeps the field accurate to well within the
 * smallest bucket above while collapsing a day of activity into one write.
 */
export const ACTIVITY_WRITE_THROTTLE_HOURS = 12;

/** Coarse activity bucket. Ordered most to least active. */
export type ActivityStatus = 'ACTIVE' | 'RECENT' | 'INACTIVE';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which bucket a candidate falls in.
 *
 * A null `lastLoginAt` reads as INACTIVE rather than as its own "never" state:
 * from an employer's point of view "signed up and never came back" and "gone
 * for a year" are the same decision, and a fourth bucket would only invite the
 * UI to render a distinction nobody acts on.
 */
export function activityStatusFor(lastLoginAt: Date | null, now: Date = new Date()): ActivityStatus {
  if (!lastLoginAt) return 'INACTIVE';
  const days = (now.getTime() - lastLoginAt.getTime()) / DAY_MS;
  if (days <= ACTIVITY.ACTIVE_WITHIN_DAYS) return 'ACTIVE';
  if (days <= ACTIVITY.RECENT_WITHIN_DAYS) return 'RECENT';
  return 'INACTIVE';
}

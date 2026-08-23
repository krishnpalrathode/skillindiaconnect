/**
 * The one-time "finish your profile" nudge — timing and scope.
 *
 * These are constants rather than settings because they describe the SHAPE of
 * the campaign, not a business rule someone tunes from the admin console. The
 * completion threshold IS such a rule, and it is deliberately NOT here — it is
 * read from the `candidates.min_completion_pct` setting at scan time, so the
 * nudge always names the same number the apply gate enforces.
 */

/**
 * How long after registering a candidate is left alone.
 *
 * 24 hours, as specified. It is a grace period, not a delay for its own sake:
 * plenty of candidates finish onboarding in one sitting, and messaging someone
 * an hour after they signed up — while they are still filling the form — reads
 * as nagging rather than help.
 */
export const PROFILE_NUDGE_DELAY_HOURS = 24;

/**
 * How far back the scan looks.
 *
 * Bounded for two reasons. It keeps an hourly scan cheap — the window is a
 * narrow slice rather than every incomplete profile ever created. And it keeps
 * the message HONEST: "you signed up yesterday, you're nearly there" is a
 * different message from one sent to somebody who registered five months ago
 * and never came back. That person deserves a re-engagement campaign written
 * for them, not this one arriving impossibly late.
 *
 * Seven days is wide enough that a missed run — a deploy, an outage, a Redis
 * restart — self-heals on the next hourly pass instead of silently skipping a
 * whole cohort forever.
 *
 * CONSEQUENCE, stated plainly: candidates who registered more than seven days
 * before this ships never receive it. That is deliberate. Nudging a months-old
 * dormant account with "you registered 24 hours ago" copy would be worse than
 * staying quiet, and a backfill campaign is a product decision, not a side
 * effect of turning this on.
 */
export const PROFILE_NUDGE_MAX_AGE_DAYS = 7;

/** Rows per page, so a large cohort can never load in one query. */
export const PROFILE_NUDGE_BATCH_SIZE = 200;

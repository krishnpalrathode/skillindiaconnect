/** Days a lapsed subscription keeps its paid entitlements before expiring. */
export const SUBSCRIPTION_GRACE_DAYS = 7;

/**
 * Pre-expiry reminder windows (days before `expiresAt`): T-7 and T-1.
 * Each window fires AT MOST ONCE per `{expiresAt, window}` — the ledger key
 * copied from S3-B3's passport discipline. A renewal writes a NEW `expiresAt`,
 * so the ladder restarts correctly for the next term.
 */
export const RENEWAL_REMINDER_WINDOWS = [7, 1] as const;
export type RenewalReminderWindow = (typeof RENEWAL_REMINDER_WINDOWS)[number];

export const SUBSCRIPTION_LIFECYCLE_BATCH_SIZE = 100;

/**
 * The FREE plan's `code` — the one plan row that never grants paid
 * entitlements. Subscriptions on this plan are ignored by effectivePlan();
 * the Free cap always comes from the FREE_MAX_ACTIVE_JOBS setting.
 */
export const FREE_PLAN_CODE = 'FREE';

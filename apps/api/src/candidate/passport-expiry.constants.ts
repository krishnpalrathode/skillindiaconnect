/**
 * Days-before-expiry windows that trigger one reminder each.
 *
 * 365 and 180 were added with the six-month apply gate. The old ladder started
 * at 60 days, which is inside the window where an ordinary Indian passport
 * renewal — police verification included — may not complete; a worker first told
 * at 60 days can be blocked from applying before their new passport arrives.
 *
 * 365 is the first nudge, while renewal is still cheap and unhurried.
 * 180 is the day the apply gate closes (PASSPORT_MIN_VALIDITY_DAYS), so that
 * reminder coincides with the candidate actually losing the ability to apply.
 */
export const REMINDER_WINDOWS = [365, 180, 60, 30, 7, 0] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

/** Cursor-paginated batch size for the passport scan loop. */
export const PASSPORT_EXPIRY_BATCH_SIZE = 200;

/** Days-before-expiry windows that trigger one reminder each. */
export const REMINDER_WINDOWS = [60, 30, 7, 0] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

/** Cursor-paginated batch size for the passport scan loop. */
export const PASSPORT_EXPIRY_BATCH_SIZE = 200;

/**
 * The one place the `other` category slug is written down.
 *
 * It lives in core rather than in either module because two of them need it
 * and neither owns it: Jobs enforces "free text is required when, and allowed
 * only when, the category is this one", and Jobs-Search pins the same row to
 * the bottom of every picker. A slug typed twice is a slug that eventually
 * disagrees with itself.
 *
 * Seeded by prisma/seed.ts alongside the ten fixed trades.
 */
export const OTHER_CATEGORY_SLUG = 'other';

/** Max length of Job.categoryOther — mirrors `@db.VarChar(80)` in the schema. */
export const CATEGORY_OTHER_MAX_LENGTH = 80;

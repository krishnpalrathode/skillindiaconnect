/**
 * Max length of the candidate's resume summary.
 *
 * Mirrors `@db.VarChar(500)` on `CandidateProfile.summary`. Kept as a named
 * constant so the DTO, the column and the UI counter all cite one number — the
 * upload-ceiling lesson applied before it becomes six literals.
 *
 * 500 is a product rule, not a storage one: past roughly a short paragraph a
 * summary stops summarising and starts pushing the work history onto a second
 * page, which is the opposite of what it is for.
 */
export const SUMMARY_MAX_LENGTH = 500;

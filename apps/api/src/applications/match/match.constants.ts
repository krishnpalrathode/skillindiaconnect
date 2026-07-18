/**
 * Match-engine constants — the locked Phase-3 formula.
 *
 * The four components sum to 100. Weights are the MAX each component can award;
 * they are snapshotted into the breakdown so the UI can render "score / max" bars
 * that stay comparable across candidates and markets.
 */
export const MATCH_WEIGHTS = {
  category: 40,
  experienceYears: 30,
  foreignExperience: 20,
  documents: 10,
} as const;

/** Overall score ceiling. The component sum is capped here defensively. */
export const MATCH_SCORE_MAX = 100;

/**
 * Experience-years INPUT clamp. Raw candidate years above this ceiling are
 * clamped to 25 BEFORE the ratio is taken, so a 40-year veteran and a 25-year
 * veteran score identically against the same requirement. Both `raw` (honest
 * input) and `clamped` (the scored value) are snapshotted in the breakdown.
 */
export const EXPERIENCE_YEARS_CLAMP = 25;

/**
 * Experience-years fallback when a job specifies no positive requirement
 * (`experienceRequiredYears` is null or 0):
 *   any experience (raw > 0) → full marks; zero experience → 0.
 * This keeps the component meaningful for "any experience welcome" postings
 * without punishing candidates for an unstated requirement.
 */
export const EXPERIENCE_FALLBACK_FULL_ON_ANY = true;

/**
 * Foreign-experience is MARKET-CONDITIONAL. It is awarded only when the job's
 * market is the overseas market (Prisma `JobMarket.GULF`) AND the candidate has
 * foreign experience. A LOCAL job NEVER awards it — the component is 0 with its
 * max still recorded as 20, so B3's applicant display can explain the honest 0
 * ("foreign experience isn't scored for local roles") rather than hiding it.
 */
export const FOREIGN_EXPERIENCE_MARKET_CONDITIONAL = true;

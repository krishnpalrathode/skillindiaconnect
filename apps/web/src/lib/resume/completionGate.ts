/**
 * How complete a profile must be before its resume can leave the platform.
 *
 * A resume built from a half-filled profile is the candidate's first impression
 * with an employer, and a thin one costs them the job rather than just looking
 * unfinished. So download and share are held back until there is enough profile
 * to be worth sending.
 *
 * DISTINCT FROM THE APPLY THRESHOLD. Applying is gated server-side on the
 * `candidates.min_completion_pct` setting (70 by default, Super-Admin tunable)
 * and is enforced by the API. This is a higher, PRESENTATION-side bar on a
 * different action, which is why it is a constant here rather than another read
 * of that setting — conflating the two would make one silently move the other.
 *
 * The gate is advisory in the security sense: it stops the UI from starting a
 * generation, not the API from serving one. That is deliberate — nothing
 * private is exposed by a candidate downloading their OWN resume, so the value
 * is in the nudge, not in enforcement.
 */
export const RESUME_MIN_COMPLETION_PCT = 80;

/** Whether the resume may be downloaded or shared at this completion level. */
export function canExportResume(pct: number | null | undefined): boolean {
  return (pct ?? 0) >= RESUME_MIN_COMPLETION_PCT;
}

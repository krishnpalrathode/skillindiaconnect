import { JobMarket } from '@prisma/client';
import { EXPERIENCE_YEARS_CLAMP, MATCH_SCORE_MAX, MATCH_WEIGHTS } from './match.constants';

/**
 * Pure inputs to the match engine. NO database access, NO Prisma types beyond the
 * plain `JobMarket` enum — everything is resolved by the caller (MatchService) so
 * this function stays a deterministic, exhaustively-testable pure function.
 */
export interface MatchComputeInput {
  candidateCategoryId: string | null;
  jobCategoryId: string;
  /** Candidate's total years of experience (unclamped). */
  totalExperienceYears: number;
  /** The job's required years, or null/0 when unspecified. */
  jobExperienceRequiredYears: number | null;
  hasForeignExperience: boolean;
  jobMarket: JobMarket;
  /** Mandatory documents actually present at apply time. */
  docsPresentCount: number;
  /** Mandatory documents required (from Settings) at apply time. */
  docsRequiredCount: number;
}

/** Matches the frozen S4-0 `MatchBreakdown` contract shape exactly. */
export interface MatchBreakdown {
  category: { score: number; max: number };
  experienceYears: { raw: number; clamped: number; score: number; max: number };
  foreignExperience: { score: number; max: number };
  documents: { score: number; max: number };
}

export interface MatchResult {
  score: number;
  breakdown: MatchBreakdown;
}

/**
 * THE match engine. Computed ONCE at apply time and snapshotted onto the
 * application row — never recomputed on later reads or edits.
 *
 * Formula (locked, Phase-3):
 *  - Category (40):      candidate category === job category → 40, else 0.
 *  - ExperienceYears(30): clamp raw at 25; if the job requires > 0 years,
 *      ratio = min(clamped / required, 1); score = round(ratio × 30). If the job
 *      requires nothing, any experience → 30, none → 0. raw + clamped snapshotted.
 *  - ForeignExperience(20): market-conditional — foreign experience AND a GULF
 *      (overseas) job → 20; a LOCAL job is always 0 (max still 20).
 *  - Documents (10):     round(10 × present / required), present/required capped at 1.
 *  - score = sum, capped at 100.
 */
export function compute(input: MatchComputeInput): MatchResult {
  // ── Category ──────────────────────────────────────────────────────────────
  const categoryScore =
    input.candidateCategoryId !== null && input.candidateCategoryId === input.jobCategoryId
      ? MATCH_WEIGHTS.category
      : 0;

  // ── Experience years (raw + clamped) ────────────────────────────────────────
  const raw = Math.max(0, input.totalExperienceYears);
  const clamped = Math.min(raw, EXPERIENCE_YEARS_CLAMP);

  let experienceScore: number;
  const required = input.jobExperienceRequiredYears;
  if (required !== null && required > 0) {
    const ratio = Math.min(clamped / required, 1);
    experienceScore = Math.round(ratio * MATCH_WEIGHTS.experienceYears);
  } else {
    // Unspecified requirement → any experience earns full marks, zero earns none.
    experienceScore = raw > 0 ? MATCH_WEIGHTS.experienceYears : 0;
  }

  // ── Foreign experience (market-conditional) ──────────────────────────────────
  const foreignScore =
    input.hasForeignExperience && input.jobMarket === JobMarket.GULF
      ? MATCH_WEIGHTS.foreignExperience
      : 0;

  // ── Documents ────────────────────────────────────────────────────────────────
  const documentsScore =
    input.docsRequiredCount > 0
      ? Math.round(
          MATCH_WEIGHTS.documents * Math.min(input.docsPresentCount / input.docsRequiredCount, 1),
        )
      : MATCH_WEIGHTS.documents; // nothing required → requirement trivially met

  const score = Math.min(
    MATCH_SCORE_MAX,
    categoryScore + experienceScore + foreignScore + documentsScore,
  );

  return {
    score,
    breakdown: {
      category: { score: categoryScore, max: MATCH_WEIGHTS.category },
      experienceYears: {
        raw,
        clamped,
        score: experienceScore,
        max: MATCH_WEIGHTS.experienceYears,
      },
      foreignExperience: { score: foreignScore, max: MATCH_WEIGHTS.foreignExperience },
      documents: { score: documentsScore, max: MATCH_WEIGHTS.documents },
    },
  };
}

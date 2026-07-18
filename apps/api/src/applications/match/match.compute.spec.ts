import { JobMarket } from '@prisma/client';
import { compute, MatchComputeInput } from './match.compute';
import { EXPERIENCE_YEARS_CLAMP, MATCH_WEIGHTS } from './match.constants';

/**
 * Pure-engine tests — the locked-logic ≥90% coverage bar. No DB, no container.
 *
 * Every component is exercised across its branches, plus the specific corrected
 * cases from the S4-0 lock: input clamp at 25, ratio cap at 1.0, null-required
 * fallback both ways, market-conditional foreign, documents rounding, and the
 * canonical full-marks = 100 with the exact breakdown shape (raw + clamped).
 */
function base(overrides: Partial<MatchComputeInput> = {}): MatchComputeInput {
  return {
    candidateCategoryId: 'cat-1',
    jobCategoryId: 'cat-1',
    totalExperienceYears: 5,
    jobExperienceRequiredYears: 5,
    hasForeignExperience: true,
    jobMarket: JobMarket.GULF,
    docsPresentCount: 2,
    docsRequiredCount: 2,
    ...overrides,
  };
}

describe('match.compute', () => {
  // ── Category (40) ───────────────────────────────────────────────────────────
  describe('category', () => {
    it('awards 40 when candidate category === job category', () => {
      const { breakdown } = compute(base({ candidateCategoryId: 'x', jobCategoryId: 'x' }));
      expect(breakdown.category).toEqual({ score: 40, max: 40 });
    });

    it('awards 0 on category mismatch', () => {
      const { breakdown } = compute(base({ candidateCategoryId: 'x', jobCategoryId: 'y' }));
      expect(breakdown.category.score).toBe(0);
      expect(breakdown.category.max).toBe(40);
    });

    it('awards 0 when the candidate has no category (null)', () => {
      const { breakdown } = compute(base({ candidateCategoryId: null }));
      expect(breakdown.category.score).toBe(0);
    });
  });

  // ── Experience years (30) — raw + clamped ───────────────────────────────────
  describe('experienceYears', () => {
    it('clamps raw 30 → clamped 25 and snapshots BOTH', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 30, jobExperienceRequiredYears: 25 }),
      );
      expect(breakdown.experienceYears.raw).toBe(30);
      expect(breakdown.experienceYears.clamped).toBe(EXPERIENCE_YEARS_CLAMP);
      // clamped(25)/required(25) = 1.0 → full 30
      expect(breakdown.experienceYears.score).toBe(30);
    });

    it('caps ratio at 1.0 (clamped 25 vs required 5 → 30, not 150)', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 25, jobExperienceRequiredYears: 5 }),
      );
      expect(breakdown.experienceYears.score).toBe(30);
    });

    it('required=5, candidate=3 → round(3/5 × 30) = 18', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 3, jobExperienceRequiredYears: 5 }),
      );
      expect(breakdown.experienceYears.raw).toBe(3);
      expect(breakdown.experienceYears.clamped).toBe(3);
      expect(breakdown.experienceYears.score).toBe(18);
    });

    it('rounds to nearest integer (required=3, candidate=1 → round(10)=10)', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 1, jobExperienceRequiredYears: 3 }),
      );
      // 1/3 × 30 = 10
      expect(breakdown.experienceYears.score).toBe(10);
    });

    it('null required → any experience earns full 30', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 2, jobExperienceRequiredYears: null }),
      );
      expect(breakdown.experienceYears.score).toBe(30);
    });

    it('null required + zero experience → 0', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: 0, jobExperienceRequiredYears: null }),
      );
      expect(breakdown.experienceYears.score).toBe(0);
    });

    it('zero required (0, not null) → treated as unspecified fallback', () => {
      const full = compute(base({ totalExperienceYears: 4, jobExperienceRequiredYears: 0 }));
      expect(full.breakdown.experienceYears.score).toBe(30);
      const none = compute(base({ totalExperienceYears: 0, jobExperienceRequiredYears: 0 }));
      expect(none.breakdown.experienceYears.score).toBe(0);
    });

    it('negative experience is floored to 0 (defensive)', () => {
      const { breakdown } = compute(
        base({ totalExperienceYears: -5, jobExperienceRequiredYears: 5 }),
      );
      expect(breakdown.experienceYears.raw).toBe(0);
      expect(breakdown.experienceYears.clamped).toBe(0);
      expect(breakdown.experienceYears.score).toBe(0);
    });
  });

  // ── Foreign experience (20) — market-conditional ────────────────────────────
  describe('foreignExperience', () => {
    it('awards 20 for foreign experience on a GULF job', () => {
      const { breakdown } = compute(
        base({ hasForeignExperience: true, jobMarket: JobMarket.GULF }),
      );
      expect(breakdown.foreignExperience).toEqual({ score: 20, max: 20 });
    });

    it('awards 0 on a LOCAL job even with foreign experience (max still 20)', () => {
      const { breakdown } = compute(
        base({ hasForeignExperience: true, jobMarket: JobMarket.LOCAL }),
      );
      expect(breakdown.foreignExperience.score).toBe(0);
      expect(breakdown.foreignExperience.max).toBe(20);
    });

    it('awards 0 on a GULF job without foreign experience', () => {
      const { breakdown } = compute(
        base({ hasForeignExperience: false, jobMarket: JobMarket.GULF }),
      );
      expect(breakdown.foreignExperience.score).toBe(0);
    });
  });

  // ── Documents (10) ──────────────────────────────────────────────────────────
  describe('documents', () => {
    it('full marks when present === required', () => {
      const { breakdown } = compute(base({ docsPresentCount: 2, docsRequiredCount: 2 }));
      expect(breakdown.documents).toEqual({ score: 10, max: 10 });
    });

    it('rounds a partial ratio (1 of 3 → round(3.33) = 3)', () => {
      const { breakdown } = compute(base({ docsPresentCount: 1, docsRequiredCount: 3 }));
      expect(breakdown.documents.score).toBe(3);
    });

    it('caps present/required at 1 (present > required never exceeds 10)', () => {
      const { breakdown } = compute(base({ docsPresentCount: 5, docsRequiredCount: 2 }));
      expect(breakdown.documents.score).toBe(10);
    });

    it('required 0 → full marks (nothing required is trivially met)', () => {
      const { breakdown } = compute(base({ docsPresentCount: 0, docsRequiredCount: 0 }));
      expect(breakdown.documents.score).toBe(10);
    });
  });

  // ── Aggregate ───────────────────────────────────────────────────────────────
  describe('total score', () => {
    it('canonical full marks = 100 with exact breakdown shape', () => {
      const result = compute(
        base({
          candidateCategoryId: 'c1',
          jobCategoryId: 'c1',
          totalExperienceYears: 10,
          jobExperienceRequiredYears: 5,
          hasForeignExperience: true,
          jobMarket: JobMarket.GULF,
          docsPresentCount: 2,
          docsRequiredCount: 2,
        }),
      );
      expect(result.score).toBe(100);
      expect(result.breakdown).toEqual({
        category: { score: 40, max: 40 },
        experienceYears: { raw: 10, clamped: 10, score: 30, max: 30 },
        foreignExperience: { score: 20, max: 20 },
        documents: { score: 10, max: 10 },
      });
    });

    it('sums the four components', () => {
      // mismatch category (0) + 18 exp + 0 foreign(local) + 3 docs = 21
      const result = compute(
        base({
          candidateCategoryId: 'a',
          jobCategoryId: 'b',
          totalExperienceYears: 3,
          jobExperienceRequiredYears: 5,
          hasForeignExperience: true,
          jobMarket: JobMarket.LOCAL,
          docsPresentCount: 1,
          docsRequiredCount: 3,
        }),
      );
      expect(result.score).toBe(0 + 18 + 0 + 3);
    });

    it('zero across the board = 0', () => {
      const result = compute({
        candidateCategoryId: null,
        jobCategoryId: 'x',
        totalExperienceYears: 0,
        jobExperienceRequiredYears: 5,
        hasForeignExperience: false,
        jobMarket: JobMarket.LOCAL,
        docsPresentCount: 0,
        docsRequiredCount: 2,
      });
      expect(result.score).toBe(0);
    });

    it('never exceeds MATCH_SCORE_MAX', () => {
      const result = compute(
        base({ docsPresentCount: 99, docsRequiredCount: 1, totalExperienceYears: 99 }),
      );
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('component maxes always sum to 100', () => {
      const { breakdown } = compute(base());
      const sumMax =
        breakdown.category.max +
        breakdown.experienceYears.max +
        breakdown.foreignExperience.max +
        breakdown.documents.max;
      expect(sumMax).toBe(100);
      expect(sumMax).toBe(
        MATCH_WEIGHTS.category +
          MATCH_WEIGHTS.experienceYears +
          MATCH_WEIGHTS.foreignExperience +
          MATCH_WEIGHTS.documents,
      );
    });
  });
});

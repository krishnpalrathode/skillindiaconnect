import { Injectable } from '@nestjs/common';
import { JobMarket } from '@prisma/client';
import { compute, MatchComputeInput, MatchResult } from './match.compute';

/**
 * The DI seam over the pure {@link compute} engine.
 *
 * It does NO database access itself — the caller (ApplyService) has already
 * loaded the candidate apply-inputs (via CandidateReadService) and the job (via
 * JobsService) for the gate, so MatchService only maps those into the pure
 * engine's input shape. Keeping the arithmetic in `match.compute.ts` (pure) is
 * what lets it hit the ≥90% locked-logic coverage bar without a container.
 */
export interface MatchInputs {
  candidateCategoryId: string | null;
  totalExperienceYears: number;
  hasForeignExperience: boolean;
  job: {
    categoryId: string;
    market: JobMarket;
    experienceRequiredYears: number | null;
  };
  docsPresentCount: number;
  docsRequiredCount: number;
}

@Injectable()
export class MatchService {
  compute(inputs: MatchInputs): MatchResult {
    const engineInput: MatchComputeInput = {
      candidateCategoryId: inputs.candidateCategoryId,
      jobCategoryId: inputs.job.categoryId,
      totalExperienceYears: inputs.totalExperienceYears,
      jobExperienceRequiredYears: inputs.job.experienceRequiredYears,
      hasForeignExperience: inputs.hasForeignExperience,
      jobMarket: inputs.job.market,
      docsPresentCount: inputs.docsPresentCount,
      docsRequiredCount: inputs.docsRequiredCount,
    };
    return compute(engineInput);
  }
}

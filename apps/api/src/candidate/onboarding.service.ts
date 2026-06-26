import { Injectable } from '@nestjs/common';
import { CompletionService } from './completion/completion.service';

@Injectable()
export class OnboardingService {
  constructor(private readonly completionService: CompletionService) {}

  /**
   * Soft-block: trigger a fresh recompute and return the resulting pct.
   * This endpoint succeeds even when mandatory documents are missing or pct < threshold.
   * The dual apply gate (≥threshold + mandatory docs + valid passport) is enforced
   * at apply time in S4, not here.
   */
  async complete(candidateId: string): Promise<{ completionPct: number }> {
    const result = await this.completionService.recomputeForCandidate(candidateId);
    return { completionPct: result.pct };
  }
}

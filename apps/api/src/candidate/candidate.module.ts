import { Module } from '@nestjs/common';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { CandidateReadService } from './candidate-read.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';
import { CompletionService } from './completion/completion.service';

@Module({
  controllers: [CandidateController],
  providers: [
    CandidateService,
    CandidateReadService,
    ExperienceService,
    SkillService,
    CompletionService,
  ],
  exports: [
    // CandidateReadService is the seam for cross-module reads.
    // S1-1 OTP login will inject this instead of querying candidate_profiles directly.
    CandidateReadService,
  ],
})
export class CandidateModule {}

import { Module, forwardRef } from '@nestjs/common';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { CandidateReadService } from './candidate-read.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';
import { CompletionService } from './completion/completion.service';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileViewsReadService } from './profile-views-read.service';
import { QueueModule } from '../queue/queue.module';
import { ApplicationsModule } from '../applications/applications.module';

@Module({
  imports: [QueueModule, forwardRef(() => ApplicationsModule)],
  controllers: [CandidateController, DocumentController, OnboardingController],
  providers: [
    CandidateService,
    CandidateReadService,
    ExperienceService,
    SkillService,
    CompletionService,
    DocumentService,
    OnboardingService,
    // Split ownership: Employer module writes profile_views; Candidate module reads own rows.
    ProfileViewsReadService,
  ],
  exports: [
    // CandidateReadService is the seam for cross-module reads.
    // S1-1 OTP login will inject this instead of querying candidate_profiles directly.
    CandidateReadService,
  ],
})
export class CandidateModule {}

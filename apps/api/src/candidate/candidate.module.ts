import { Module, forwardRef } from '@nestjs/common';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { CandidateReadService } from './candidate-read.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';
import { CompletionService } from './completion/completion.service';
import { NotificationModule } from '../notifications/notification.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProfileViewsReadService } from './profile-views-read.service';
import { QueueModule } from '../queue/queue.module';
import { ApplicationsModule } from '../applications/applications.module';
import { SettingsModule } from '../settings/settings.module';
import { VideoService } from './video.service';

@Module({
  // SettingsModule: the video size/length ceilings are Super-Admin tunable
  // settings, so VideoService reads them through SettingsService rather than
  // hardcoding numbers an admin believes they can change.
  imports: [QueueModule, NotificationModule, SettingsModule, forwardRef(() => ApplicationsModule)],
  controllers: [CandidateController, DocumentController, OnboardingController],
  providers: [
    CandidateService,
    CandidateReadService,
    ExperienceService,
    SkillService,
    CompletionService,
    DocumentService,
    VideoService,
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

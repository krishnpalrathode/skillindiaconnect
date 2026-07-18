import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { R2Module } from '../core/storage/r2.module';
import { RedisModule } from '../core/redis/redis.module';
import { CandidateModule } from '../candidate/candidate.module';
import { NotificationModule } from '../notifications/notification.module';
import { ResumeController } from './resume.controller';
import { ResumeService } from './resume.service';
import { ResumeSettingsService } from './resume-settings.service';
import { ResumeDeliveryService } from './resume-delivery.service';

/**
 * API-process side of the Resume module (S7-B2): settings CRUD, the
 * generate/poll pair, and the two deliveries.
 *
 * NOTE WHAT IS ABSENT: PdfModule. Chromium is a worker-only dependency
 * (S7-B1) and this module is what keeps that true on the API side — importing
 * it here would put a browser in every API replica. The structural spec
 * asserts the API's import closure reaches no pdf/ file.
 *
 * Cross-module seams (Rule 3/4): CandidateReadService for profile data,
 * NotificationService for every send. This module owns candidate_resumes +
 * resume_generations and queries nothing else.
 */
@Module({
  imports: [
    QueueModule, // RESUME_RENDER queue registration (producer only)
    R2Module,
    RedisModule, // the 5/day send budget
    CandidateModule,
    NotificationModule,
  ],
  controllers: [ResumeController],
  providers: [ResumeService, ResumeSettingsService, ResumeDeliveryService],
  exports: [ResumeService],
})
export class ResumeModule {}

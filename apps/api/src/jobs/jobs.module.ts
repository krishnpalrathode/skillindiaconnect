import { Module } from '@nestjs/common';
import { EmployerModule } from '../employer/employer.module';
import { SettingsModule } from '../settings/settings.module';
import { QueueModule } from '../queue/queue.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { JobsSubscriber } from './jobs.subscriber';

/**
 * API-process side of the Jobs module.
 *
 * Provides: CRUD + lifecycle (employer-facing), publish enforcement gate,
 * and the employer.suspended → pause-jobs event subscriber.
 *
 * The worker-process side (auto-archive cron + processor) lives in
 * JobsWorkerModule and is imported only by AppWorkerModule.
 *
 * AuditModule is @Global — AuditService is auto-injectable without explicit import.
 * R2Module is @Global — not needed here.
 *
 * Exports JobsService so other modules (future: Applications) can call
 * assertJobPublished / getJobForApplication without querying the jobs table directly.
 *
 * saved_jobs ownership: B6 (Search) module, not here. The save/unsave endpoints
 * live alongside the public job search/detail routes.
 */
@Module({
  imports: [
    EmployerModule,   // EmployerService: assertApproved, getCompanyForEmployerUser, getCompanyType
    SettingsModule,   // SettingsService: protection rules, auto-archive days, quota settings
    QueueModule,      // BullMQ: auto-archive queue registration (producer side)
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobLifecycleService,
    PublishGuardService,
    JobsSubscriber,
  ],
  exports: [JobsService],
})
export class JobsModule {}

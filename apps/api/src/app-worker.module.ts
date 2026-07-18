import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CoreModule } from './core/core.module';
import { AuditModule } from './audit/audit.module';
import { NotificationWorkerModule } from './notifications/notification.worker-module';
import { JobsWorkerModule } from './jobs/jobs.worker-module';
import { CandidateWorkerModule } from './candidate/candidate.worker-module';
import { PaymentsWorkerModule } from './payments/payments.worker-module';
import { ResumeWorkerModule } from './resume/resume.worker-module';

// Loads: CoreModule (config + Redis) + ScheduleModule (cron runner).
// Must NOT import AppApiModule or any HTTP controllers.
@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AuditModule,
    NotificationWorkerModule,
    JobsWorkerModule,
    CandidateWorkerModule,
    PaymentsWorkerModule,
    // S7-B1: Puppeteer renders (resume). Chromium lives HERE and only here —
    // AppApiModule must never import ResumeWorkerModule or PdfModule.
    ResumeWorkerModule,
  ],
})
export class AppWorkerModule {}

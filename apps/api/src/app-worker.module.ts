import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CoreModule } from './core/core.module';
import { ObservabilityModule } from './core/observability/observability.module';
import { R2DeleteWorkerModule } from './core/storage/r2-delete.worker-module';
import { AuditModule } from './audit/audit.module';
import { NotificationWorkerModule } from './notifications/notification.worker-module';
import { JobsWorkerModule } from './jobs/jobs.worker-module';
import { CandidateWorkerModule } from './candidate/candidate.worker-module';
import { EmployerWorkerModule } from './employer/employer.worker-module';
import { PaymentsWorkerModule } from './payments/payments.worker-module';
import { ResumeWorkerModule } from './resume/resume.worker-module';

// Loads: CoreModule (config + Redis) + ScheduleModule (cron runner).
// Must NOT import AppApiModule or any HTTP controllers.
@Module({
  imports: [
    CoreModule,
    ObservabilityModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AuditModule,
    // The R2_DELETE consumer. Absent until now, so every document deletion ever
    // enqueued is still waiting in Redis — see r2-delete.processor.ts.
    R2DeleteWorkerModule,
    NotificationWorkerModule,
    JobsWorkerModule,
    CandidateWorkerModule,
    EmployerWorkerModule,
    PaymentsWorkerModule,
    // S7-B1: Puppeteer renders (resume). Chromium lives HERE and only here —
    // AppApiModule must never import ResumeWorkerModule or PdfModule.
    ResumeWorkerModule,
  ],
})
export class AppWorkerModule {}

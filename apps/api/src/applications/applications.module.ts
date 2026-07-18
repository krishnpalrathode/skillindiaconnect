import { Module, forwardRef } from '@nestjs/common';
import { CandidateModule } from '../candidate/candidate.module';
import { JobsModule } from '../jobs/jobs.module';
import { EmployerModule } from '../employer/employer.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationModule } from '../notifications/notification.module';
import { ApplyController } from './apply.controller';
import { ApplyService } from './apply.service';
import { ApplyGateService } from './apply-gate.service';
import { MatchService } from './match/match.service';
import { StatusController } from './status.controller';
import { AdminStatusController } from './admin-status.controller';
import { StatusService } from './status.service';
import { CandidateApplicationsController } from './candidate-applications.controller';
import { ApplicantsController } from './applicants.controller';
import { AdminApplicationsController } from './admin-applications.controller';
import { ApplicationsReadService } from './applications-read.service';
import { ApplicationsAggregateService } from './applications-aggregate.service';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';
import { AdminResendController } from './admin-resend.controller';
import { AdminResendService } from './admin-resend.service';

/**
 * Applications module (S4 B1 apply · B2 transitions · B3 reads + aggregates).
 *
 * Owns `applications` + `application_timeline`. Reads candidate/job/company data
 * ONLY via CandidateReadService / JobsService / EmployerService (Rule 4).
 *
 * `ApplicationsAggregateService` is EXPORTED — the employer & candidate dashboards
 * and the My-Jobs counts consume it (no one else queries the applications table).
 * Those consumers import THIS module, so Candidate/Jobs/Employer are imported via
 * forwardRef to break the resulting cycles (same pattern as Employer↔Jobs).
 */
@Module({
  imports: [
    forwardRef(() => CandidateModule),
    forwardRef(() => JobsModule),
    forwardRef(() => EmployerModule),
    SettingsModule,
    NotificationModule,
  ],
  controllers: [
    ApplyController,
    StatusController,
    AdminStatusController,
    CandidateApplicationsController,
    ApplicantsController,
    AdminApplicationsController,
    AdminNotesController, // S6b-B2: internal notes (owns application_notes)
    AdminResendController, // S6b-B2: the bypassGuard resend endpoint
  ],
  providers: [
    ApplyService,
    ApplyGateService,
    MatchService,
    StatusService,
    ApplicationsReadService,
    ApplicationsAggregateService,
    AdminNotesService,
    AdminResendService,
  ],
  exports: [ApplicationsAggregateService],
})
export class ApplicationsModule {}

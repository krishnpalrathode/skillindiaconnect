import { Module, forwardRef } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { CandidateModule } from '../candidate/candidate.module';
import { ApplicationsModule } from '../applications/applications.module';
import { SubscriptionReadModule } from '../payments/subscription-read.module';
import { EmployerController } from './employer.controller';
import { AdminEmployerController } from './admin-employer.controller';
import { EmployerProfileController } from './employer-profile.controller';
import { CandidateViewController } from './candidate-view.controller';
import { DocumentAccessController } from './document-access.controller';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';
import { EmployerProfileService } from './employer-profile.service';
import { EmployerDashboardService } from './employer-dashboard.service';
import { CandidateViewService } from './candidate-view.service';
import { ProfileViewService } from './profile-view.service';
import { DocumentAccessService } from './document-access.service';

@Module({
  imports: [
    // forwardRef: JobsModule also imports EmployerModule for PublishGuardService.
    // EmployerDashboardService needs JobsService for real dashboard aggregates (S3-B1).
    forwardRef(() => JobsModule),
    // CandidateModule exports CandidateReadService — the boundary for employer→candidate reads.
    // forwardRef: S4-B3 pulled CandidateModule into the Candidate↔Applications↔Jobs↔Employer
    // cycle (CandidateModule now imports ApplicationsModule), so at app boot this binding is
    // still undefined when EmployerModule's decorator evaluates — defer it like the others.
    forwardRef(() => CandidateModule),
    // ApplicationsModule exports ApplicationsAggregateService (S4-B3 dashboard KPIs/recent).
    forwardRef(() => ApplicationsModule),
    // effectivePlan(): the document gate's plan truth (S5-B3) — standalone module,
    // NOT PaymentsModule (which imports EmployerModule; that would be a cycle).
    SubscriptionReadModule,
  ],
  controllers: [
    EmployerController,
    AdminEmployerController,
    EmployerProfileController,
    CandidateViewController,
    DocumentAccessController,
  ],
  providers: [
    EmployerService,
    EmployerApprovalService,
    EmployerProfileService,
    EmployerDashboardService,
    CandidateViewService,
    ProfileViewService,
    DocumentAccessService,
  ],
  // EmployerService: Jobs injects assertApproved / getCompanyForEmployerUser (Rule 4).
  // EmployerProfileService: exported for checklist access if needed by future modules.
  exports: [EmployerService, EmployerProfileService],
})
export class EmployerModule {}

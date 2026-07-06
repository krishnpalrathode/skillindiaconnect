import { Module, forwardRef } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { CandidateModule } from '../candidate/candidate.module';
import { ApplicationsModule } from '../applications/applications.module';
import { EmployerController } from './employer.controller';
import { AdminEmployerController } from './admin-employer.controller';
import { EmployerProfileController } from './employer-profile.controller';
import { CandidateViewController } from './candidate-view.controller';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';
import { EmployerProfileService } from './employer-profile.service';
import { EmployerDashboardService } from './employer-dashboard.service';
import { CandidateViewService } from './candidate-view.service';
import { ProfileViewService } from './profile-view.service';

@Module({
  imports: [
    // forwardRef: JobsModule also imports EmployerModule for PublishGuardService.
    // EmployerDashboardService needs JobsService for real dashboard aggregates (S3-B1).
    forwardRef(() => JobsModule),
    // CandidateModule exports CandidateReadService — the boundary for employer→candidate reads.
    CandidateModule,
    // ApplicationsModule exports ApplicationsAggregateService (S4-B3 dashboard KPIs/recent).
    forwardRef(() => ApplicationsModule),
  ],
  controllers: [
    EmployerController,
    AdminEmployerController,
    EmployerProfileController,
    CandidateViewController,
  ],
  providers: [
    EmployerService,
    EmployerApprovalService,
    EmployerProfileService,
    EmployerDashboardService,
    CandidateViewService,
    ProfileViewService,
  ],
  // EmployerService: Jobs injects assertApproved / getCompanyForEmployerUser (Rule 4).
  // EmployerProfileService: exported for checklist access if needed by future modules.
  exports: [EmployerService, EmployerProfileService],
})
export class EmployerModule {}

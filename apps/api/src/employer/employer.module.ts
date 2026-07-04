import { Module, forwardRef } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { EmployerController } from './employer.controller';
import { AdminEmployerController } from './admin-employer.controller';
import { EmployerProfileController } from './employer-profile.controller';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';
import { EmployerProfileService } from './employer-profile.service';
import { EmployerDashboardService } from './employer-dashboard.service';

@Module({
  imports: [
    // forwardRef: JobsModule also imports EmployerModule for PublishGuardService.
    // EmployerDashboardService needs JobsService for real dashboard aggregates (S3-B1).
    forwardRef(() => JobsModule),
  ],
  controllers: [EmployerController, AdminEmployerController, EmployerProfileController],
  providers: [
    EmployerService,
    EmployerApprovalService,
    EmployerProfileService,
    EmployerDashboardService,
  ],
  // EmployerService: Jobs injects assertApproved / getCompanyForEmployerUser (Rule 4).
  // EmployerProfileService: exported for checklist access if needed by future modules.
  exports: [EmployerService, EmployerProfileService],
})
export class EmployerModule {}

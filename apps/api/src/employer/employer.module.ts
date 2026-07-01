import { Module } from '@nestjs/common';
import { EmployerController } from './employer.controller';
import { AdminEmployerController } from './admin-employer.controller';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';

@Module({
  controllers: [EmployerController, AdminEmployerController],
  providers: [EmployerService, EmployerApprovalService],
  // EmployerService exported so Jobs (S2-B5) can inject assertApproved / getCompanyType
  // without querying employer tables directly (module-boundaries.md Rule 4).
  exports: [EmployerService],
})
export class EmployerModule {}

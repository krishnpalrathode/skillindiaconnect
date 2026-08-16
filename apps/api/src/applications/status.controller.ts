import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EmployerService } from '../employer/employer.service';
import { StatusService } from './status.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ApplicationResponse, toApplicationResponse } from './application.mapper';

/**
 * PATCH /api/v1/applications/:id/status — employer forward-only status change.
 *
 * The employer moves their own applicants FORWARD only (matrix in status.service).
 * Scoping is enforced INSIDE the locked transition: the application's job must
 * belong to the caller's company, else 404 (existence not leaked). Not RBAC-gated —
 * a candidate/admin token is rejected as NOT_EMPLOYER.
 */
@Controller('applications')
export class StatusController {
  constructor(
    private readonly statusService: StatusService,
    private readonly employerService: EmployerService,
  ) {}

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ApplicationResponse }> {
    this.statusService.assertEmployer(user.role);
    const company = await this.employerService.getCompanyForEmployerUser(user.userId);

    const updated = await this.statusService.transition(
      id,
      dto.status,
      {
        type: 'EMPLOYER',
        userId: user.userId,
        role: user.role,
        companyId: company.id,
      },
      {
        rejectionFeedback: dto.rejectionFeedback,
      },
    );

    return { data: toApplicationResponse(updated) };
  }
}

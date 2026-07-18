import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EmployerService } from '../employer/employer.service';
import { ApplicationsReadService } from './applications-read.service';
import { ListApplicantsDto } from './dto/list-applicants.dto';

/**
 * GET /api/v1/jobs/:id/applicants — employer applicant list for their OWN job.
 *
 * Ownership: the job must belong to the caller's company (checked in the read
 * service against the resolved companyId) → else 404 (existence not leaked).
 * Cursor + match|recent sort + per-status `counts`. Each ApplicantCard composes
 * the S3 employer-context subset (privacy inherited).
 */
@Controller('jobs')
export class ApplicantsController {
  constructor(
    private readonly readService: ApplicationsReadService,
    private readonly employerService: EmployerService,
  ) {}

  @Get(':id/applicants')
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) jobId: string,
    @Query() dto: ListApplicantsDto,
  ) {
    if (user.role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'NOT_EMPLOYER' });
    }
    const company = await this.employerService.getCompanyForEmployerUser(user.userId);
    return this.readService.listJobApplicants(jobId, company.id, dto);
  }
}

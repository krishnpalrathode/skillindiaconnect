import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { ApplicationsReadService } from './applications-read.service';
import { ListCandidateApplicationsDto } from './dto/list-candidate-applications.dto';

/**
 * GET /api/v1/candidates/me/applications  (+ /:id)
 *
 * Candidate-only. The list is an offset page (newest first); the detail includes
 * the SHAPED timeline (overrideReason + actor identity excluded by the mapper).
 * Own-application scoping: another candidate's id → 404.
 */
@Controller('candidates/me/applications')
export class CandidateApplicationsController {
  constructor(
    private readonly readService: ApplicationsReadService,
    private readonly candidateRead: CandidateReadService,
  ) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() dto: ListCandidateApplicationsDto) {
    const candidateId = await this.resolveCandidateId(user);
    return this.readService.listCandidateApplications(candidateId, dto);
  }

  @Get(':id')
  async detail(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const candidateId = await this.resolveCandidateId(user);
    const data = await this.readService.getCandidateApplicationDetail(candidateId, id);
    return { data };
  }

  private async resolveCandidateId(user: CurrentUserPayload): Promise<string> {
    if (user.role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    }
    const candidateId = await this.candidateRead.getCandidateIdForUser(user.userId);
    if (!candidateId) throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    return candidateId;
  }
}

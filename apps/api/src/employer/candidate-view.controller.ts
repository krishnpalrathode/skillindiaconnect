import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateViewService } from './candidate-view.service';
import { BrowseQueryDto } from './dto/browse-query.dto';

@Controller('employers')
export class CandidateViewController {
  constructor(private readonly candidateViewService: CandidateViewService) {}

  // ── GET /employers/candidates ─────────────────────────────────────────────

  @Get('candidates')
  async browse(
    @CurrentUser() user: CurrentUserPayload,
    @Query() dto: BrowseQueryDto,
  ) {
    this.assertEmployerRole(user.role);
    return this.candidateViewService.browse(user.userId, dto);
  }

  // ── GET /employers/candidates/:id ─────────────────────────────────────────

  @Get('candidates/:id')
  async viewCandidate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) candidateId: string,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.candidateViewService.viewCandidate(user.userId, candidateId) };
  }

  private assertEmployerRole(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
  }
}

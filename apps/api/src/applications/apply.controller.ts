import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ApplyService } from './apply.service';
import { ApplyDto } from './dto/apply.dto';
import { ApplicationResponse } from './application.mapper';

/**
 * POST /api/v1/jobs/:id/apply — a CANDIDATE applies to a job.
 *
 * JwtAuthGuard (global) authenticates; the role check here is the ONLY
 * authorization needed — a candidate applies as themselves, so ownership is
 * implicit. The gate ladder + match snapshot live in ApplyService.
 */
@Controller('jobs')
export class ApplyController {
  constructor(private readonly applyService: ApplyService) {}

  @Post(':id/apply')
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Param('id', ParseUUIDPipe) jobId: string,
    @Body() dto: ApplyDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ApplicationResponse }> {
    if (user.role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    }
    const data = await this.applyService.apply(user.userId, jobId, dto, user.role);
    return { data };
  }
}

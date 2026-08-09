import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { RATE_LIMITS } from '../core/config/rate-limits';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateInterestService } from './candidate-interest.service';
import { ListInterestDto } from './dto/list-interest.dto';
import { NotifyInterestDto } from './dto/notify-interest.dto';

/**
 * Employer-side "interested candidates" — mark, un-mark, list, and reach out.
 *
 * Every route is EMPLOYER-only and scoped to the caller's own company inside the
 * service; nothing here takes a companyId from the request.
 */
@Controller('employers')
export class CandidateInterestController {
  constructor(private readonly interestService: CandidateInterestService) {}

  /** POST /employers/candidates/:id/interest — mark. Idempotent. */
  @Post('candidates/:id/interest')
  @HttpCode(HttpStatus.OK)
  async mark(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) candidateId: string,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.interestService.markInterest(user.userId, candidateId) };
  }

  /** DELETE /employers/candidates/:id/interest — un-mark. Idempotent (no 404). */
  @Delete('candidates/:id/interest')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unmark(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) candidateId: string,
  ): Promise<void> {
    this.assertEmployerRole(user.role);
    await this.interestService.removeInterest(user.userId, candidateId);
  }

  /**
   * GET /employers/interested-candidates
   *
   * NOT `candidates/interested`: the sibling CandidateViewController owns
   * `GET candidates/:id` with a ParseUUIDPipe, and across two controllers the
   * winner is decided by module registration order — `interested` was being
   * swallowed and 400ing as a malformed UUID. A distinct first segment removes
   * the ordering dependency entirely rather than encoding it in a comment.
   */
  @Get('interested-candidates')
  async list(@CurrentUser() user: CurrentUserPayload, @Query() dto: ListInterestDto) {
    this.assertEmployerRole(user.role);
    return this.interestService.list(user.userId, dto);
  }

  /**
   * POST /employers/interested-candidates/notify — reach out to marked candidates.
   *
   * Rate-limited: every accepted entry becomes a paid WhatsApp conversation, and
   * this is an employer→worker messaging channel. The service additionally skips
   * anyone this company has already contacted.
   */
  @Post('interested-candidates/notify')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: RATE_LIMITS.interestNotify })
  async notify(@CurrentUser() user: CurrentUserPayload, @Body() dto: NotifyInterestDto) {
    this.assertEmployerRole(user.role);
    return { data: await this.interestService.notify(user.userId, dto.candidateIds) };
  }

  private assertEmployerRole(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
  }
}

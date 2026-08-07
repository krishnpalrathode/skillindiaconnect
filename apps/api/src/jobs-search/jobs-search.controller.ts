/**
 * Public job search + detail + saved-jobs endpoints.
 *
 * GET  /jobs          — unauthenticated, rate-limited 30/min (search)
 * GET  /jobs/:id      — unauthenticated (public detail)
 * POST /jobs/:id/save — CANDIDATE auth only (save)
 * DELETE /jobs/:id/save — CANDIDATE auth only (unsave)
 *
 * The two GET routes are decorated @Public() so JwtAuthGuard skips them.
 * The save/unsave routes require a valid JWT; SavedJobsService enforces CANDIDATE role.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMITS } from '../core/config/rate-limits';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import {
  OptionalAuth,
  CurrentUserOptional,
} from '../auth/decorators/optional-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { JobsSearchService } from './jobs-search.service';
import { SavedJobsService } from './saved-jobs.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('jobs')
export class JobsSearchController {
  constructor(
    private readonly searchService: JobsSearchService,
    private readonly savedJobsService: SavedJobsService,
  ) {}

  /**
   * Public job search (FTS + trgm + filters + cursor pagination).
   * Rate-limited to 30/min per api-conventions.md.
   */
  @Get()
  @Public()
  @OptionalAuth()
  @Throttle({ default: RATE_LIMITS.search })
  async search(
    @Query() query: SearchQueryDto,
    @CurrentUserOptional() user: CurrentUserPayload | null,
  ) {
    const viewer = user ? { userId: user.userId, role: user.role } : null;
    return this.searchService.search(query, viewer);
  }

  /**
   * Countries that currently have ACTIVE jobs — the source for the candidate
   * search's country filter.
   *
   * MUST stay declared ABOVE `@Get(':id')`: Nest matches routes in declaration
   * order, so the dynamic route would otherwise swallow "countries" and hand it
   * to ParseUUIDPipe as an id.
   */
  @Get('countries')
  @Public()
  @Throttle({ default: RATE_LIMITS.search })
  async countries() {
    return { data: await this.searchService.listCountries() };
  }

  /**
   * Public job detail. 404 for non-ACTIVE (paused / draft / archived / pending).
   * No employer PII — public-subset only (enforced in the mapper).
   * Optional-auth: an authenticated candidate gets isSaved populated.
   */
  @Get(':id')
  @Public()
  @OptionalAuth()
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserOptional() user: CurrentUserPayload | null,
  ) {
    const viewer = user ? { userId: user.userId, role: user.role } : null;
    const data = await this.searchService.getDetail(id, viewer);
    return { data };
  }

  /**
   * Candidate saves a job. Idempotent (upsert). 200 on repeat saves.
   * JwtAuthGuard enforces authentication; SavedJobsService enforces CANDIDATE role.
   */
  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.savedJobsService.save(user.userId, user.role as UserRole, id);
    return { data: { saved: true } };
  }

  /**
   * Candidate unsaves a job. Idempotent — no 404 if not previously saved.
   */
  @Delete(':id/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.savedJobsService.unsave(user.userId, user.role as UserRole, id);
  }
}

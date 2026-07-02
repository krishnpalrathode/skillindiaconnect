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
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
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
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async search(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }

  /**
   * Public job detail. 404 for non-ACTIVE (paused / draft / archived / pending).
   * No employer PII — public-subset only (enforced in the mapper).
   */
  @Get(':id')
  @Public()
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.searchService.getDetail(id);
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

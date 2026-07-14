import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminJobsService } from './admin-jobs.service';
import {
  AdminJobActionDto,
  JobFlagsDto,
  ListAdminJobsDto,
  OnBehalfCreateJobDto,
  ReviewJobDto,
} from './dto/admin-jobs.dto';

/**
 * Admin job moderation (S6b-B2, Screen 26). Lives in the Jobs module — the
 * table owner (the `admin` module owns no tables).
 *
 * RBAC per the frozen contract: reads on `jobs.view`, moderation (review,
 * pause, archive, flags) on `jobs.moderate`, on-behalf creation on
 * `jobs.post_admin` (locked decision 4 — the contract reuses the existing key
 * rather than forking `jobs.create_onbehalf`).
 */
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly adminJobs: AdminJobsService) {}

  @Get()
  @RequirePermissions(Permission.JOBS_VIEW)
  async list(@Query() query: ListAdminJobsDto) {
    return this.adminJobs.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.JOBS_VIEW)
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.adminJobs.getDetail(id) };
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK) // contract: 200 with the resolved row
  @RequirePermissions(Permission.JOBS_MODERATE)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewJobDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminJobs.review(id, dto, { userId: user.userId, role: user.role }),
    };
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.JOBS_MODERATE)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminJobActionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminJobs.pause(id, dto, { userId: user.userId, role: user.role }),
    };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.JOBS_MODERATE)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminJobActionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminJobs.archive(id, dto, { userId: user.userId, role: user.role }),
    };
  }

  @Patch(':id/flags')
  @RequirePermissions(Permission.JOBS_MODERATE)
  async setFlags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobFlagsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminJobs.setFlags(id, dto, { userId: user.userId, role: user.role }),
    };
  }

  @Post()
  @RequirePermissions(Permission.JOBS_POST_ADMIN)
  async createOnBehalf(@Body() dto: OnBehalfCreateJobDto, @CurrentUser() user: CurrentUserPayload) {
    return {
      data: await this.adminJobs.createOnBehalf(dto, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }
}

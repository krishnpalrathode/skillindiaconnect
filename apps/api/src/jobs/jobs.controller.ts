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
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';

/**
 * All routes require a JWT-authenticated EMPLOYER.
 * JwtAuthGuard (global APP_GUARD) handles authentication.
 * No additional RequirePermissions needed — role is checked implicitly
 * through ownership (company linked to the authenticated user).
 *
 * Saved-jobs (save/unsave) are owned by the B6 Search module, not here.
 */
@Controller('employers/me/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateJobDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.create(dto, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Get()
  async list(
    @Query() query: ListJobsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.jobsService.list(user.userId, query);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.findOne(id, user.userId);
    return { data: job };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.update(id, dto, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.publish(id, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.pause(id, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.resume(id, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.archive(id, user.userId, user.role as UserRole);
    return { data: job };
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const job = await this.jobsService.duplicate(id, user.userId, user.role as UserRole);
    return { data: job };
  }
}

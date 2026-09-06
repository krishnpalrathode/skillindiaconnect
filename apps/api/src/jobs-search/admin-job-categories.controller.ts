/**
 * Admin job-category CRUD (Screen: Admin → Job Categories).
 *
 *   GET    /admin/job-categories        → list all (incl. inactive) + job counts
 *   POST   /admin/job-categories        → create
 *   PATCH  /admin/job-categories/:id    → edit names / active
 *   DELETE /admin/job-categories/:id    → hard-delete (only when unused; never 'other')
 *
 * All gated on Permission.JOB_CATEGORIES_MANAGE. Auth is the global JwtAuthGuard;
 * this controller only adds the permission check, matching SettingsController.
 * The public GET /job-categories (isActive only) stays in JobCategoriesController.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Permission } from '../auth/rbac/permission.constants';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { CreateJobCategoryDto } from './dto/create-job-category.dto';
import { UpdateJobCategoryDto } from './dto/update-job-category.dto';
import { JobCategoryAdminService } from './job-category-admin.service';

@Controller('admin/job-categories')
export class AdminJobCategoriesController {
  constructor(private readonly service: JobCategoryAdminService) {}

  @Get()
  @RequirePermissions(Permission.JOB_CATEGORIES_MANAGE)
  async list() {
    return { data: await this.service.listAll() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.JOB_CATEGORIES_MANAGE)
  async create(@Body() dto: CreateJobCategoryDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @RequirePermissions(Permission.JOB_CATEGORIES_MANAGE)
  async update(@Param('id') id: string, @Body() dto: UpdateJobCategoryDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.JOB_CATEGORIES_MANAGE)
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}

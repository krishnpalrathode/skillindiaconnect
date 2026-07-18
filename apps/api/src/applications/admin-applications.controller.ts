import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { ApplicationsReadService } from './applications-read.service';
import { ListAdminApplicationsDto } from './dto/list-admin-applications.dto';

/**
 * GET /api/v1/admin/applications — admin-wide offset table (the read-side pairing
 * of B2's override endpoint; S6 renders it on Screen 26) — and, since 0.8.1,
 * GET /admin/applications/{id}: the detail with the FULL timeline including
 * per-entry `overrideReason` (the admin-only serialization of the record the
 * candidate's shaped timeline deliberately excludes).
 *
 * RBAC: `applications.manage` — seeded ON for ADMIN, OFF for MODERATOR (live
 * boundary via the global PermissionsGuard → MODERATOR gets 403). Admin-context
 * card: candidate name + ids, no document keys.
 */
@Controller('admin/applications')
export class AdminApplicationsController {
  constructor(private readonly readService: ApplicationsReadService) {}

  @Get()
  @RequirePermissions(Permission.APPLICATIONS_MANAGE)
  async list(@Query() dto: ListAdminApplicationsDto) {
    return this.readService.listAdminApplications(dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.APPLICATIONS_MANAGE)
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.readService.getAdminApplicationDetail(id) };
  }
}

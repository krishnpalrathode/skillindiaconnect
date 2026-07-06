import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { StatusService } from './status.service';
import { AdminOverrideDto } from './dto/admin-override.dto';
import { ApplicationResponse, toApplicationResponse } from './application.mapper';

/**
 * PATCH /api/v1/admin/applications/:id/status — admin corrective (override).
 *
 * RBAC: `applications.change_status` — seeded ON for ADMIN, OFF for MODERATOR (a
 * live boundary; a MODERATOR token gets 403 from the global PermissionsGuard).
 * Admins may move to ANY status except the current one, with a MANDATORY reason.
 *
 * The response is the ADMIN context — it carries `overrideReason` (the reason just
 * applied). Candidate/employer contexts never see it.
 */
@Controller('admin/applications')
export class AdminStatusController {
  constructor(private readonly statusService: StatusService) {}

  @Patch(':id/status')
  @RequirePermissions(Permission.APPLICATIONS_CHANGE_STATUS)
  async overrideStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOverrideDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ApplicationResponse & { overrideReason: string } }> {
    const updated = await this.statusService.transition(id, dto.status, {
      type: 'ADMIN',
      userId: user.userId,
      role: user.role,
    }, {
      overrideReason: dto.overrideReason,
    });

    return { data: { ...toApplicationResponse(updated), overrideReason: dto.overrideReason } };
  }
}

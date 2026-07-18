import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from './require-permissions.decorator';
import { Permission } from './permission.constants';
import { RbacMatrixService } from './rbac-matrix.service';
import { UpdateCellDto } from './dto/update-cell.dto';

/**
 * GET/PATCH /api/v1/admin/roles/matrix — Screen 27.
 *
 * Lives in the AUTH module because `role_permissions` is auth's table
 * (PermissionService already reads it on every guarded request) and
 * module-boundaries Rule 4 says a module reads only its own tables. The admin
 * console is the caller, not the owner. AuthModule is loaded by the API root
 * only — the worker never imports it — so no controller reaches the worker.
 *
 * Two keys, not one, for the same reason logs.view and logs.export are split:
 *   - roles.view   → SEE who can do what (ADMIN holds this).
 *   - roles.manage → CHANGE who can do what (SUPER_ADMIN-effective: seeded
 *                    ON+locked for SUPER_ADMIN, locked OFF everywhere else).
 * Reading the matrix and rewriting the platform's authority model are not the
 * same act, and one key for both would make the distinction unenforceable.
 */
@Controller('admin/roles')
export class RbacMatrixController {
  constructor(private readonly rbacMatrixService: RbacMatrixService) {}

  @Get('matrix')
  @RequirePermissions(Permission.ROLES_VIEW)
  async getMatrix() {
    return { data: await this.rbacMatrixService.getMatrix() };
  }

  @Patch('matrix')
  @RequirePermissions(Permission.ROLES_MANAGE)
  async updateCell(@Body() dto: UpdateCellDto, @CurrentUser() user: CurrentUserPayload) {
    const cell = await this.rbacMatrixService.updateCell(dto, {
      userId: user.userId,
      role: user.role,
    });
    return { data: cell };
  }
}

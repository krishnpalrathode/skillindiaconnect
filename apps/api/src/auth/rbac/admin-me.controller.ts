import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { PermissionService } from './permission.service';
import { MATRIX_ROLES } from './rbac-matrix.constants';

/**
 * GET /api/v1/admin/me/permissions — the admin console's navigation source.
 *
 * WHY THIS EXISTS (S6a-F1). The console's nav renders from the caller's EFFECTIVE
 * PERMISSION SET, never from their role name. Screen 27 grants and revokes
 * permissions at RUNTIME — so a client that inferred capability from the role
 * would show a role a nav that no longer matches what the server will actually
 * let it do. The client must ask; it may never derive.
 *
 * NO @RequirePermissions. Self-introspection cannot itself require a grant: a
 * role holding nothing must still be able to discover that, or the console cannot
 * render its (empty) nav at all and the user gets a blank screen instead of an
 * honest one. The gate is simply "is this an admin-side role".
 *
 * This is UX INPUT ONLY. Every real endpoint re-checks with PermissionsGuard —
 * the set returned here is the same one that guard reads (same table, same
 * role-scoped cache), so a forced URL to a hidden screen still gets a 403.
 */
@Controller('admin/me')
export class AdminMeController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get('permissions')
  async getMyPermissions(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { role: UserRole; permissions: string[] } }> {
    if (!MATRIX_ROLES.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        detail: 'This endpoint is for admin-console roles only.',
      });
    }

    const permissions = await this.permissionService.getPermissionsForRole(user.role);
    return { data: { role: user.role, permissions: [...permissions] } };
  }
}

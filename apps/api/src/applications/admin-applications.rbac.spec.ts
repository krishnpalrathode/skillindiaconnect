import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionsGuard } from '../auth/rbac/permissions.guard';
import { PermissionService } from '../auth/rbac/permission.service';
import { Permission } from '../auth/rbac/permission.constants';
import { REQUIRE_PERMISSIONS_KEY } from '../auth/rbac/require-permissions.decorator';
import { AdminApplicationsController } from './admin-applications.controller';

/**
 * The admin applications LIST is gated by `applications.manage` (seeded ON for
 * ADMIN, OFF for MODERATOR). Proven at the guard level, no Docker.
 */
function ctx(role: UserRole): ExecutionContext {
  return {
    getHandler: () => AdminApplicationsController.prototype.list,
    getClass: () => AdminApplicationsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u', role, jti: 'j', exp: 0 } }) }),
  } as unknown as ExecutionContext;
}

describe('AdminApplicationsController RBAC', () => {
  const reflector = new Reflector();
  const permService = {
    getPermissionsForRole: jest.fn(async (role: UserRole) =>
      role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN
        ? new Set<string>([Permission.APPLICATIONS_MANAGE])
        : new Set<string>(),
    ),
  } as unknown as PermissionService;
  const guard = new PermissionsGuard(reflector, permService);

  it('the handler requires applications.manage', () => {
    expect(reflector.get(REQUIRE_PERMISSIONS_KEY, AdminApplicationsController.prototype.list)).toEqual([
      Permission.APPLICATIONS_MANAGE,
    ]);
  });

  it('ADMIN passes', async () => {
    await expect(guard.canActivate(ctx(UserRole.ADMIN))).resolves.toBe(true);
  });

  it('MODERATOR → 403 (seed boundary, not a bug)', async () => {
    await expect(guard.canActivate(ctx(UserRole.MODERATOR))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

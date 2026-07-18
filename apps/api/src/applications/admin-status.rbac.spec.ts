import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionsGuard } from '../auth/rbac/permissions.guard';
import { PermissionService } from '../auth/rbac/permission.service';
import { Permission } from '../auth/rbac/permission.constants';
import { REQUIRE_PERMISSIONS_KEY } from '../auth/rbac/require-permissions.decorator';
import { AdminStatusController } from './admin-status.controller';

/**
 * The admin override is RBAC-gated by the GLOBAL PermissionsGuard. This proves the
 * live boundary deterministically (no Docker): the handler requires
 * `applications.change_status`, ADMIN has it (seed ON), MODERATOR does NOT (seed
 * OFF) → 403. We do NOT "fix" MODERATOR — its 403 is the seed matrix working.
 */
function ctx(role: UserRole): ExecutionContext {
  return {
    getHandler: () => AdminStatusController.prototype.overrideStatus,
    getClass: () => AdminStatusController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 'u', role, jti: 'j', exp: 0 } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminStatusController RBAC', () => {
  const reflector = new Reflector();

  const permService = {
    getPermissionsForRole: jest.fn(async (role: UserRole) =>
      role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN
        ? new Set<string>([Permission.APPLICATIONS_CHANGE_STATUS])
        : new Set<string>(),
    ),
  } as unknown as PermissionService;

  const guard = new PermissionsGuard(reflector, permService);

  it('the handler requires applications.change_status', () => {
    const required = reflector.get(
      REQUIRE_PERMISSIONS_KEY,
      AdminStatusController.prototype.overrideStatus,
    );
    expect(required).toEqual([Permission.APPLICATIONS_CHANGE_STATUS]);
  });

  it('ADMIN (permission ON) passes the guard', async () => {
    await expect(guard.canActivate(ctx(UserRole.ADMIN))).resolves.toBe(true);
  });

  it('MODERATOR (permission OFF) is rejected with 403 — the seed boundary, not a bug', async () => {
    await expect(guard.canActivate(ctx(UserRole.MODERATOR))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

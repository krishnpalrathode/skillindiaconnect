import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { PermissionService } from './permission.service';
import { REQUIRE_PERMISSIONS_KEY } from './require-permissions.decorator';
import { Permission } from './permission.constants';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

function makeContext(user: CurrentUserPayload | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => (user ? { user } : {}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeUser(role: UserRole): CurrentUserPayload {
  return { userId: 'u1', role, jti: 'jti-1', exp: 9_999_999_999 };
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflectorMock: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let permServiceMock: jest.Mocked<Pick<PermissionService, 'getPermissionsForRole'>>;

  beforeEach(async () => {
    reflectorMock = { getAllAndOverride: jest.fn() };
    permServiceMock = { getPermissionsForRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflectorMock },
        { provide: PermissionService, useValue: permServiceMock },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
  });

  it('allows any authenticated route that has no @RequirePermissions (undefined)', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext(makeUser(UserRole.CANDIDATE)))).resolves.toBe(true);
    expect(permServiceMock.getPermissionsForRole).not.toHaveBeenCalled();
  });

  it('allows any authenticated route that has no @RequirePermissions (empty array)', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([]);
    await expect(guard.canActivate(makeContext(makeUser(UserRole.EMPLOYER)))).resolves.toBe(true);
    expect(permServiceMock.getPermissionsForRole).not.toHaveBeenCalled();
  });

  it('allows when role has ALL required keys', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Permission.CANDIDATES_VIEW]);
    permServiceMock.getPermissionsForRole.mockResolvedValue(
      new Set([Permission.CANDIDATES_VIEW, Permission.CANDIDATES_EDIT]),
    );
    await expect(guard.canActivate(makeContext(makeUser(UserRole.SUPER_ADMIN)))).resolves.toBe(
      true,
    );
  });

  it('throws 403 with missing keys when role lacks a required permission', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Permission.CANDIDATES_VIEW]);
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([]));

    let error: unknown;
    try {
      await guard.canActivate(makeContext(makeUser(UserRole.SUPPORT)));
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'FORBIDDEN',
      meta: { missing: [Permission.CANDIDATES_VIEW] },
    });
  });

  it('throws 403 for CANDIDATE (empty permission set) hitting a protected route', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Permission.CANDIDATES_VIEW]);
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([]));
    await expect(guard.canActivate(makeContext(makeUser(UserRole.CANDIDATE)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 for EMPLOYER (empty permission set) hitting a protected route', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Permission.REPORTS_VIEW]);
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([]));
    await expect(guard.canActivate(makeContext(makeUser(UserRole.EMPLOYER)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('enforces AND semantics — all required keys must be present', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([
      Permission.CANDIDATES_VIEW,
      Permission.CANDIDATES_EDIT,
    ]);
    // Role has only one of the two required keys.
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([Permission.CANDIDATES_VIEW]));
    await expect(guard.canActivate(makeContext(makeUser(UserRole.SUPPORT)))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 on @Public() + @RequirePermissions() misconfiguration (no req.user)', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Permission.CANDIDATES_VIEW]);
    await expect(guard.canActivate(makeContext(null))).rejects.toThrow(ForbiddenException);
  });

  it('reads metadata from REQUIRE_PERMISSIONS_KEY', () => {
    guard.canActivate(makeContext(makeUser(UserRole.SUPER_ADMIN)));
    expect(reflectorMock.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRE_PERMISSIONS_KEY,
      expect.any(Array),
    );
  });
});

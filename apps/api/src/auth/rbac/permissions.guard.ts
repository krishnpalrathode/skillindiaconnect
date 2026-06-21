import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { PermissionService } from './permission.service';
import { REQUIRE_PERMISSIONS_KEY } from './require-permissions.decorator';
import type { PermissionKey } from './permission.constants';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequirePermissions → authentication (JwtAuthGuard) is enough.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    const user = request.user;

    // Defensive: JwtAuthGuard runs first and always sets user on non-public routes.
    // A @Public() + @RequirePermissions() combination is a misconfiguration — deny.
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const perms = await this.permissionService.getPermissionsForRole(user.role);
    const missing = required.filter((k) => !perms.has(k));

    if (missing.length > 0) {
      throw new ForbiddenException({ code: 'FORBIDDEN', meta: { missing } });
    }

    return true;
  }
}

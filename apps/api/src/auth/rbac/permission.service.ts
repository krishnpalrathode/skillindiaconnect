import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditStatus, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';

const CACHE_TTL_SECONDS = 300;

function cacheKey(role: UserRole): string {
  return `rbac:perms:${role}`;
}

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getPermissionsForRole(role: UserRole): Promise<Set<string>> {
    const key = cacheKey(role);
    const cached = await this.redis.get(key);
    if (cached !== null) {
      return new Set<string>(JSON.parse(cached) as string[]);
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: { role, enabled: true },
      select: { permissionKey: true },
    });
    const keys = rows.map((r: { permissionKey: string }) => r.permissionKey);
    await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(keys));
    return new Set<string>(keys);
  }

  async hasPermission(role: UserRole, permKey: string): Promise<boolean> {
    const perms = await this.getPermissionsForRole(role);
    return perms.has(permKey);
  }

  async setPermission(
    role: UserRole,
    permKey: string,
    enabled: boolean,
    actorUserId: string,
  ): Promise<void> {
    const row = await this.prisma.rolePermission.findUnique({
      where: { role_permissionKey: { role, permissionKey: permKey } },
    });

    if (!row) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND' });
    }

    if (row.isLocked) {
      throw new HttpException(
        { code: 'PERMISSION_LOCKED', message: 'This permission is locked and cannot be changed' },
        423,
      );
    }

    await this.prisma.rolePermission.update({
      where: { role_permissionKey: { role, permissionKey: permKey } },
      data: { enabled },
    });

    await this.redis.del(cacheKey(role));

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'PERMISSION_UPDATE',
        module: 'auth',
        targetType: 'role_permission',
        targetId: `${role}:${permKey}`,
        status: AuditStatus.SUCCESS,
        meta: { role, permissionKey: permKey, enabled },
      },
    });
  }
}

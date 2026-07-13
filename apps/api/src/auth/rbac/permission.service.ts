import { Inject, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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

  /**
   * THE cache-invalidation path. One implementation, one cache key — the same
   * `cacheKey()` the read path above populates, so an invalidation can never
   * miss because two call sites disagreed about the key format.
   *
   * Called post-commit by RbacMatrixService (S6a-B2), the only writer of
   * `role_permissions`. If this ever stops working, a revoked permission keeps
   * being granted until the 300s TTL lapses — a silent, time-boxed security
   * hole — which is why the matrix integration spec asserts a revoke takes effect
   * on the very NEXT request, with no TTL grace.
   *
   * Scope is per-role, not a global flush: invalidating ADMIN must not evict
   * MODERATOR's cached grants and stampede the DB on every unrelated request.
   */
  async invalidateRoleCache(role: UserRole): Promise<void> {
    await this.redis.del(cacheKey(role));
  }
}

/*
 * S6a-B2 removed `setPermission()` from this service.
 *
 * It was a SECOND write path into `role_permissions` — unreachable (no route ever
 * called it) but fully armed, and weaker than the real one: no SUPER_ADMIN
 * column protection, no self-lockout guard, a non-transactional audit row that
 * could silently vanish while the grant landed, and a `PERMISSION_LOCKED` code
 * that does not match the contract's `PERMISSION_CELL_LOCKED`. Leaving it beside
 * the guarded path is how the two drift until someone wires up the wrong one.
 *
 * RbacMatrixService is now the ONLY writer; this service resolves, caches, and
 * invalidates.
 */

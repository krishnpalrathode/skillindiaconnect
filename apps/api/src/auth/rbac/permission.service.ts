import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Resolve a role's grants: Redis first, Postgres as the source of truth.
   *
   * CHAOS-001 (S8-H3) — REDIS IS AN OPTIMISATION HERE, NOT A DEPENDENCY.
   * A cache read/write failure must never decide an authorization outcome, so
   * both are wrapped and fall through to the DB. The safety argument:
   *
   *  - `role_permissions` is the AUTHORITATIVE grant table. Falling back to it
   *    yields the correct answer, not a permissive one — this degrades
   *    performance (a query per request while Redis is down), never security.
   *  - A cache MISS and a cache ERROR are therefore treated identically.
   *  - If the DB is also unreachable the query throws, the guard never returns
   *    true, and the request is denied. FAIL CLOSED is preserved on every path;
   *    there is no branch here that can grant a permission the DB does not.
   *
   * Before this, an unbounded Redis command left the request hanging rather
   * than resolving either way — see redis.provider.ts.
   */
  async getPermissionsForRole(role: UserRole): Promise<Set<string>> {
    const key = cacheKey(role);

    let cached: string | null = null;
    try {
      cached = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `permission cache read failed for ${role} — falling back to the database: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (cached !== null) {
      return new Set<string>(JSON.parse(cached) as string[]);
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: { role, enabled: true },
      select: { permissionKey: true },
    });
    const keys = rows.map((r: { permissionKey: string }) => r.permissionKey);

    try {
      await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(keys));
    } catch {
      // Repopulating the cache is best-effort; the answer above is already
      // authoritative. Not logged at warn — the read failure above already
      // reported the outage, and one line per request would flood the log.
    }
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
    // Deliberately NOT wrapped: a failed invalidation must propagate. If the
    // grant landed in the DB but the stale cache entry survived, callers would
    // keep seeing the OLD permission set for up to the TTL — for a REVOKE that
    // is a silent, time-boxed security hole. The caller (RbacMatrixService)
    // needs to know, so this is the one Redis call here that is allowed to fail
    // the request.
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

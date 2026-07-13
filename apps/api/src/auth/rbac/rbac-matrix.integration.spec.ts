/**
 * The RBAC matrix API (S6a-B2) end-to-end: real Postgres, real Redis, the real
 * PermissionsGuard, the real controllers, the real global pipe + error filter.
 *
 * THE POINT OF THIS FILE is the cache-invalidation proof. 5b built permission
 * resolution behind a 300-second Redis cache and built an invalidation path — but
 * nothing in the product had ever CHANGED a permission at runtime, so that path
 * had never actually executed. If it is broken, a revoked permission KEEPS
 * WORKING for up to five minutes: a silent, time-boxed security hole that no
 * existing test would catch.
 *
 * So we do not assert that `del` was called. We flip a real cell through HTTP and
 * then make a real request as the affected role, and require the answer to change
 * on the VERY NEXT REQUEST — no restart, no relogin, no TTL wait. And we flip it
 * through the actual S6a-B1 export endpoint (`GET /admin/logs/export`, keyed on
 * `logs.export`), not a toy controller, so what is proven is the production path.
 *
 * Skips gracefully when Docker is unavailable, like the other container specs.
 */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import supertest from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { HttpProblemFilter, validationProblemFactory } from '../../core/http-problem.filter';
import { AuditService } from '../../audit/audit.service';
import { AuditQueryService } from '../../audit/audit-query.service';
import { AuditQueryController } from '../../audit/audit-query.controller';
import { AUDIT_ACTIONS } from '../../audit/audit.types';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { Permission } from './permission.constants';
import { PermissionService } from './permission.service';
import { PermissionsGuard } from './permissions.guard';
import { RbacMatrixController } from './rbac-matrix.controller';
import { RbacMatrixService } from './rbac-matrix.service';
import { AdminMeController } from './admin-me.controller';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../../..');

const USER_ID: Record<string, string> = {
  SUPER_ADMIN: '11111111-1111-4111-8111-111111111111',
  ADMIN: '22222222-2222-4222-8222-222222222222',
  MODERATOR: '33333333-3333-4333-8333-333333333333',
};

/** Authenticates from a header so we can act as any role without minting JWTs. */
@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: CurrentUserPayload;
    }>();
    const role = req.headers['x-test-role'] as UserRole | undefined;
    if (!role) return false;
    req.user = {
      userId: USER_ID[role] ?? '99999999-9999-4999-8999-999999999999',
      role,
      jti: 'test-jti',
      exp: 9_999_999_999,
    };
    return true;
  }
}

let pg: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let redis: Redis;
let app: INestApplication;
let matrixService: RbacMatrixService;
let dockerUnavailable = false;

type Cell = { role: UserRole; permission: string; enabled: boolean; locked: boolean };

const cell = (role: UserRole, permissionKey: string, enabled: boolean, isLocked: boolean) => ({
  role,
  permissionKey,
  enabled,
  isLocked,
});

const get = (url: string, role: UserRole) =>
  supertest(app.getHttpServer()).get(url).set('x-test-role', role);

const patch = (body: Record<string, unknown>, role: UserRole) =>
  supertest(app.getHttpServer()).patch('/admin/roles/matrix').set('x-test-role', role).send(body);

const rowFor = (role: UserRole, permissionKey: string) =>
  prisma.rolePermission.findUnique({
    where: { role_permissionKey: { role, permissionKey } },
  });

const countAuditRows = () =>
  prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.RBAC_PERMISSION_CHANGED } });

beforeAll(async () => {
  try {
    [pg, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_test' })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_test`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prisma.$connect();
    redis = new Redis(`redis://localhost:${redisContainer.getMappedPort(6379)}`);

    // The fixture matrix. NOTE the SUPER_ADMIN rows are seeded isLocked=FALSE on
    // purpose: the column lock is a CODE invariant, and the tests below prove the
    // API locks them anyway. If lockedness were read from the DB alone, these
    // rows would be editable — which is exactly the unadministrable-platform
    // scenario the code invariant exists to make impossible.
    await prisma.rolePermission.createMany({
      data: [
        cell(UserRole.SUPER_ADMIN, Permission.ROLES_VIEW, true, false),
        cell(UserRole.SUPER_ADMIN, Permission.ROLES_MANAGE, true, false),
        cell(UserRole.SUPER_ADMIN, Permission.LOGS_VIEW, true, false),
        cell(UserRole.SUPER_ADMIN, Permission.LOGS_EXPORT, true, false),

        // ADMIN: may SEE the matrix, may never CHANGE it (roles.manage locked off).
        cell(UserRole.ADMIN, Permission.ROLES_VIEW, true, false),
        cell(UserRole.ADMIN, Permission.ROLES_MANAGE, false, true),
        cell(UserRole.ADMIN, Permission.LOGS_VIEW, true, false),
        cell(UserRole.ADMIN, Permission.LOGS_EXPORT, true, false),

        // MODERATOR: logs.export OFF and UNLOCKED — the cell the invalidation
        // proof grants and revokes at runtime.
        cell(UserRole.MODERATOR, Permission.ROLES_VIEW, false, false),
        cell(UserRole.MODERATOR, Permission.ROLES_MANAGE, false, true),
        cell(UserRole.MODERATOR, Permission.LOGS_VIEW, true, false),
        cell(UserRole.MODERATOR, Permission.LOGS_EXPORT, false, false),

        // SUPPORT: billing.manage is the SEEDED locked cell (locked off by policy).
        cell(UserRole.SUPPORT, Permission.ROLES_VIEW, false, false),
        cell(UserRole.SUPPORT, Permission.ROLES_MANAGE, false, true),
        cell(UserRole.SUPPORT, Permission.BILLING_MANAGE, false, true),
      ],
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [RbacMatrixController, AuditQueryController, AdminMeController],
      providers: [
        RbacMatrixService,
        PermissionService,
        AuditService,
        AuditQueryService,
        { provide: PrismaService, useValue: prisma as unknown as PrismaService },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: APP_GUARD, useClass: TestAuthGuard },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector, ps: PermissionService) =>
            new PermissionsGuard(reflector, ps),
          inject: [Reflector, PermissionService],
        },
        // Mirror main.api.ts so error CODES/envelopes here are the real ones.
        { provide: APP_FILTER, useClass: HttpProblemFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationProblemFactory,
      }),
    );
    await app.init();

    matrixService = app.get(RbacMatrixService);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized')
    ) {
      dockerUnavailable = true;
      console.warn('[integration] Docker unavailable - skipping:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  redis?.disconnect();
  await pg?.stop();
  await redisContainer?.stop();
});

// ─── GET /admin/roles/matrix ─────────────────────────────────────────────────

describe('GET /admin/roles/matrix', () => {
  it('returns the full rectangular grid: every role x every permission', async () => {
    if (dockerUnavailable) return;
    const res = await get('/admin/roles/matrix', UserRole.SUPER_ADMIN).expect(200);
    const { roles, permissions, cells } = res.body.data as {
      roles: UserRole[];
      permissions: string[];
      cells: Cell[];
    };

    expect(roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT']);
    expect(permissions).toHaveLength(27);
    // Rectangular — no holes. The FE renders a grid; a missing cell is a gap in it.
    expect(cells).toHaveLength(roles.length * permissions.length);
    expect(new Set(cells.map((c) => `${c.role} ${c.permission}`)).size).toBe(cells.length);
  });

  it('locks EVERY SUPER_ADMIN cell — even though every one is isLocked=false in the DB', async () => {
    if (dockerUnavailable) return;

    // Guard the premise: if the fixture ever starts seeding these locked, this
    // test would pass without proving anything.
    const dbRows = await prisma.rolePermission.findMany({
      where: { role: UserRole.SUPER_ADMIN },
    });
    expect(dbRows.length).toBeGreaterThan(0);
    expect(dbRows.every((r) => r.isLocked === false)).toBe(true);

    const res = await get('/admin/roles/matrix', UserRole.SUPER_ADMIN).expect(200);
    const cells = (res.body.data.cells as Cell[]).filter((c) => c.role === UserRole.SUPER_ADMIN);

    expect(cells).toHaveLength(27);
    expect(cells.every((c) => c.locked)).toBe(true);
  });

  it('reflects the seeded locked set, and leaves ordinary cells unlocked', async () => {
    if (dockerUnavailable) return;
    const res = await get('/admin/roles/matrix', UserRole.SUPER_ADMIN).expect(200);
    const cells = res.body.data.cells as Cell[];
    const at = (role: UserRole, permission: string) =>
      cells.find((c) => c.role === role && c.permission === permission)!;

    expect(at(UserRole.SUPPORT, Permission.BILLING_MANAGE).locked).toBe(true);
    expect(at(UserRole.ADMIN, Permission.ROLES_MANAGE).locked).toBe(true);
    expect(at(UserRole.MODERATOR, Permission.LOGS_EXPORT).locked).toBe(false);
    expect(at(UserRole.ADMIN, Permission.ROLES_VIEW).locked).toBe(false);
  });

  it('synthesises an unseeded cell as disabled rather than leaving a hole', async () => {
    if (dockerUnavailable) return;
    // Nothing seeds SUPPORT/candidates.export in this fixture.
    expect(await rowFor(UserRole.SUPPORT, Permission.CANDIDATES_EXPORT)).toBeNull();

    const res = await get('/admin/roles/matrix', UserRole.SUPER_ADMIN).expect(200);
    const c = (res.body.data.cells as Cell[]).find(
      (x) => x.role === UserRole.SUPPORT && x.permission === Permission.CANDIDATES_EXPORT,
    )!;
    expect(c).toMatchObject({ enabled: false, locked: false });
  });

  it('RBAC: a role without roles.view is denied (MODERATOR)', async () => {
    if (dockerUnavailable) return;
    await get('/admin/roles/matrix', UserRole.MODERATOR).expect(403);
  });

  it('RBAC: ADMIN holds roles.view and may read the matrix', async () => {
    if (dockerUnavailable) return;
    await get('/admin/roles/matrix', UserRole.ADMIN).expect(200);
  });
});

// ─── PATCH /admin/roles/matrix ───────────────────────────────────────────────

describe('PATCH /admin/roles/matrix', () => {
  it('423 PERMISSION_CELL_LOCKED on a SUPER_ADMIN cell — nothing written, nothing audited', async () => {
    if (dockerUnavailable) return;
    const auditBefore = await countAuditRows();

    const res = await patch(
      { role: UserRole.SUPER_ADMIN, permission: Permission.LOGS_EXPORT, enabled: false },
      UserRole.SUPER_ADMIN,
    ).expect(423);

    expect(res.body.code).toBe('PERMISSION_CELL_LOCKED');
    expect((await rowFor(UserRole.SUPER_ADMIN, Permission.LOGS_EXPORT))!.enabled).toBe(true);
    expect(await countAuditRows()).toBe(auditBefore);
  });

  it('423 on a SEEDED locked cell (SUPPORT / billing.manage) — nothing written', async () => {
    if (dockerUnavailable) return;
    const auditBefore = await countAuditRows();

    const res = await patch(
      { role: UserRole.SUPPORT, permission: Permission.BILLING_MANAGE, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(423);

    expect(res.body.code).toBe('PERMISSION_CELL_LOCKED');
    expect((await rowFor(UserRole.SUPPORT, Permission.BILLING_MANAGE))!.enabled).toBe(false);
    expect(await countAuditRows()).toBe(auditBefore);
  });

  it('RBAC: ADMIN can VIEW but not MANAGE — PATCH is 403', async () => {
    if (dockerUnavailable) return;
    await get('/admin/roles/matrix', UserRole.ADMIN).expect(200);
    await patch(
      { role: UserRole.MODERATOR, permission: Permission.LOGS_EXPORT, enabled: true },
      UserRole.ADMIN,
    ).expect(403);
  });

  it('rejects an unknown permission key — loudly, never a silent no-op', async () => {
    if (dockerUnavailable) return;
    const res = await patch(
      { role: UserRole.MODERATOR, permission: 'logs.exfiltrate', enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.meta.errors).toContainEqual(
      expect.objectContaining({ field: 'permission' }),
    );
  });

  it('rejects a non-matrix role (EMPLOYER is not a console column)', async () => {
    if (dockerUnavailable) return;
    const res = await patch(
      { role: UserRole.EMPLOYER, permission: Permission.LOGS_VIEW, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(400);
    expect(res.body.meta.errors).toContainEqual(expect.objectContaining({ field: 'role' }));
  });

  it('404 on a valid-but-unseeded cell — it does NOT silently create the grant', async () => {
    if (dockerUnavailable) return;
    expect(await rowFor(UserRole.SUPPORT, Permission.CANDIDATES_EXPORT)).toBeNull();

    const res = await patch(
      { role: UserRole.SUPPORT, permission: Permission.CANDIDATES_EXPORT, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(404);

    expect(res.body.code).toBe('PERMISSION_NOT_FOUND');
    // The key point: a permission key is a code+seed change. PATCH flips cells; it
    // does not mint them. Still absent afterwards.
    expect(await rowFor(UserRole.SUPPORT, Permission.CANDIDATES_EXPORT)).toBeNull();
  });

  it('no-op write returns 200 and writes NO audit row', async () => {
    if (dockerUnavailable) return;
    const auditBefore = await countAuditRows();

    // MODERATOR/logs.view is already true.
    const res = await patch(
      { role: UserRole.MODERATOR, permission: Permission.LOGS_VIEW, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(200);

    expect(res.body.data).toMatchObject({ enabled: true, locked: false });
    // An audit trail that records non-events is a trail nobody reads.
    expect(await countAuditRows()).toBe(auditBefore);
  });

  it('happy path: grants a cell, and the write + audit row commit together', async () => {
    if (dockerUnavailable) return;
    const auditBefore = await countAuditRows();

    const res = await patch(
      { role: UserRole.MODERATOR, permission: Permission.ROLES_VIEW, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(200);

    expect(res.body.data).toEqual({
      role: UserRole.MODERATOR,
      permission: Permission.ROLES_VIEW,
      enabled: true,
      locked: false,
    });
    expect((await rowFor(UserRole.MODERATOR, Permission.ROLES_VIEW))!.enabled).toBe(true);
    expect(await countAuditRows()).toBe(auditBefore + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.RBAC_PERMISSION_CHANGED },
      orderBy: { id: 'desc' },
    });
    expect(audit).toMatchObject({
      actorUserId: USER_ID['SUPER_ADMIN'],
      actorRole: UserRole.SUPER_ADMIN,
      targetType: 'RolePermission',
      targetId: `${UserRole.MODERATOR}/${Permission.ROLES_VIEW}`,
    });
    // from -> to, so "who widened this, and from what?" is answerable later.
    expect(audit!.meta).toMatchObject({ from: false, to: true });

    // Put it back so later tests see the seeded state.
    await patch(
      { role: UserRole.MODERATOR, permission: Permission.ROLES_VIEW, enabled: false },
      UserRole.SUPER_ADMIN,
    ).expect(200);
  });

  it('422 SELF_LOCKOUT_FORBIDDEN: an ADMIN with roles.manage cannot revoke it from ADMIN', async () => {
    if (dockerUnavailable) return;

    // Under the SHIPPED seed this is unreachable — roles.manage is locked-OFF for
    // every non-super role, so no ADMIN can hold it. We construct the hypothetical
    // future seed that grants it, precisely so the guard is proven to land WITH
    // that grant rather than after the incident.
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.ADMIN,
          permissionKey: Permission.ROLES_MANAGE,
        },
      },
      data: { enabled: true, isLocked: false },
    });
    await app.get(PermissionService).invalidateRoleCache(UserRole.ADMIN);

    const auditBefore = await countAuditRows();
    const res = await patch(
      { role: UserRole.ADMIN, permission: Permission.ROLES_MANAGE, enabled: false },
      UserRole.ADMIN,
    ).expect(422);

    expect(res.body.code).toBe('SELF_LOCKOUT_FORBIDDEN');
    expect((await rowFor(UserRole.ADMIN, Permission.ROLES_MANAGE))!.enabled).toBe(true);
    expect(await countAuditRows()).toBe(auditBefore);

    // Restore the shipped shape.
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.ADMIN,
          permissionKey: Permission.ROLES_MANAGE,
        },
      },
      data: { enabled: false, isLocked: true },
    });
    await app.get(PermissionService).invalidateRoleCache(UserRole.ADMIN);
  });

  /**
   * LAST_MANAGER_FORBIDDEN is UNREACHABLE over HTTP, and that is worth stating
   * rather than quietly leaving a test that pretends otherwise:
   *
   *   PermissionsGuard requires the caller to hold roles.manage, so the caller's
   *   own role is always an ENABLED manager. If the caller's role IS the target,
   *   self-lockout fires first; if it is NOT, then the caller's role survives in
   *   `remaining` and the count can never reach zero.
   *
   * So the guard exists for callers that do not come through the guard: a script,
   * a migration, a future admin CLI. "The HTTP guard happens to protect us" is an
   * accidental invariant, not a designed one — this asserts the designed one, by
   * calling the service directly the way such a caller would.
   */
  it('422 LAST_MANAGER_FORBIDDEN: the final roles.manager cannot be stripped (service-level)', async () => {
    if (dockerUnavailable) return;

    // Make ADMIN the ONE AND ONLY enabled manager.
    await prisma.rolePermission.updateMany({
      where: { permissionKey: Permission.ROLES_MANAGE },
      data: { enabled: false },
    });
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.ADMIN,
          permissionKey: Permission.ROLES_MANAGE,
        },
      },
      data: { enabled: true, isLocked: false },
    });

    const auditBefore = await countAuditRows();
    await expect(
      matrixService.updateCell(
        { role: UserRole.ADMIN, permission: Permission.ROLES_MANAGE, enabled: false },
        // A SUPER_ADMIN actor who does NOT currently hold roles.manage — i.e. a
        // caller the HTTP guard would have rejected. Exactly the out-of-band path.
        { userId: USER_ID['SUPER_ADMIN']!, role: UserRole.SUPER_ADMIN },
      ),
    ).rejects.toMatchObject({ status: 422, response: { code: 'LAST_MANAGER_FORBIDDEN' } });

    expect((await rowFor(UserRole.ADMIN, Permission.ROLES_MANAGE))!.enabled).toBe(true);
    expect(await countAuditRows()).toBe(auditBefore);

    // Restore.
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.ADMIN,
          permissionKey: Permission.ROLES_MANAGE,
        },
      },
      data: { enabled: false, isLocked: true },
    });
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.SUPER_ADMIN,
          permissionKey: Permission.ROLES_MANAGE,
        },
      },
      data: { enabled: true },
    });
    await app.get(PermissionService).invalidateRoleCache(UserRole.SUPER_ADMIN);
    await app.get(PermissionService).invalidateRoleCache(UserRole.ADMIN);
  });
});

// ─── THE cache-invalidation proof ────────────────────────────────────────────

describe('cache invalidation — the first runtime exercise of 5b\'s path', () => {
  const EXPORT = '/admin/logs/export';
  const cacheKey = (role: UserRole) => `rbac:perms:${role}`;

  it('a GRANT takes effect on the very NEXT request (no restart, no TTL wait)', async () => {
    if (dockerUnavailable) return;

    // Baseline: MODERATOR lacks logs.export. This request also WARMS the Redis
    // cache with the denied grant-set — without which the "next request" below
    // would succeed for the wrong reason (a cold cache re-reads the DB anyway,
    // which would prove nothing about invalidation).
    await get(EXPORT, UserRole.MODERATOR).expect(403);
    expect(await redis.get(cacheKey(UserRole.MODERATOR))).not.toBeNull();

    await patch(
      { role: UserRole.MODERATOR, permission: Permission.LOGS_EXPORT, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(200);

    // The cached entry must be GONE — not merely stale-but-expiring.
    expect(await redis.get(cacheKey(UserRole.MODERATOR))).toBeNull();

    // THE assertion. Same role, same "token", immediately: 200.
    await get(EXPORT, UserRole.MODERATOR).expect(200);
  });

  it('a REVOKE is enforced on the very NEXT request — no 300s TTL grace', async () => {
    if (dockerUnavailable) return;

    // Precondition from the previous test: MODERATOR has logs.export, and the
    // GRANTED set is now cached (that 200 warmed it).
    await get(EXPORT, UserRole.MODERATOR).expect(200);
    expect(await redis.get(cacheKey(UserRole.MODERATOR))).not.toBeNull();

    await patch(
      { role: UserRole.MODERATOR, permission: Permission.LOGS_EXPORT, enabled: false },
      UserRole.SUPER_ADMIN,
    ).expect(200);

    // This is the security-critical direction. If invalidation were broken, the
    // revoked MODERATOR would keep exporting the entire audit trail for up to
    // five more minutes, and nothing would log an error.
    await get(EXPORT, UserRole.MODERATOR).expect(403);
  });

  it('invalidation is SCOPED to the affected role — other roles keep their cache', async () => {
    if (dockerUnavailable) return;

    // Warm ADMIN's cache.
    await get('/admin/roles/matrix', UserRole.ADMIN).expect(200);
    expect(await redis.get(cacheKey(UserRole.ADMIN))).not.toBeNull();

    await patch(
      { role: UserRole.MODERATOR, permission: Permission.LOGS_EXPORT, enabled: true },
      UserRole.SUPER_ADMIN,
    ).expect(200);

    // MODERATOR evicted; ADMIN untouched. A global flush would work too — and
    // would stampede the DB with a full re-read for every role on every flip.
    expect(await redis.get(cacheKey(UserRole.MODERATOR))).toBeNull();
    expect(await redis.get(cacheKey(UserRole.ADMIN))).not.toBeNull();

    // ADMIN's actual grants are unchanged, not just its cache entry.
    await get('/admin/roles/matrix', UserRole.ADMIN).expect(200);
  });
});

// ─── GET /admin/me/permissions — the console's nav source (S6a-F1) ───────────

describe('GET /admin/me/permissions', () => {
  // Earlier cache-invalidation tests leave MODERATOR's logs.export flipped ON.
  // Reset the fixture to its seeded shape so these tests read the intended state.
  beforeAll(async () => {
    if (dockerUnavailable) return;
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.MODERATOR,
          permissionKey: Permission.LOGS_EXPORT,
        },
      },
      data: { enabled: false },
    });
    await app.get(PermissionService).invalidateRoleCache(UserRole.MODERATOR);
  });

  it('returns the role and its effective (enabled-only) permission set', async () => {
    if (dockerUnavailable) return;
    const res = await get('/admin/me/permissions', UserRole.MODERATOR).expect(200);

    expect(res.body.data.role).toBe(UserRole.MODERATOR);
    const perms: string[] = res.body.data.permissions;
    // Holds logs.view (enabled), lacks logs.export (disabled) and roles.view.
    expect(perms).toContain(Permission.LOGS_VIEW);
    expect(perms).not.toContain(Permission.LOGS_EXPORT);
    expect(perms).not.toContain(Permission.ROLES_VIEW);
  });

  it('is NOT itself permission-gated — a role with few grants still gets its own list', async () => {
    if (dockerUnavailable) return;
    // SUPPORT holds no roles.view/logs.view here, yet must still discover what it
    // has — self-introspection cannot require a grant, or the console can't render.
    const res = await get('/admin/me/permissions', UserRole.SUPPORT).expect(200);
    expect(res.body.data.role).toBe(UserRole.SUPPORT);
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
  });

  it('the set it returns MATCHES what the guard enforces (same source)', async () => {
    if (dockerUnavailable) return;

    // Pin MODERATOR to a known shape — earlier cache-invalidation tests flip
    // logs.export, so we can't rely on the seeded value here. Set it OFF and
    // invalidate, then assert the nav source and the guard agree on it.
    await prisma.rolePermission.update({
      where: {
        role_permissionKey: {
          role: UserRole.MODERATOR,
          permissionKey: Permission.LOGS_EXPORT,
        },
      },
      data: { enabled: false },
    });
    await app.get(PermissionService).invalidateRoleCache(UserRole.MODERATOR);

    const me = await get('/admin/me/permissions', UserRole.MODERATOR).expect(200);
    // Includes logs.view → the logs endpoint (keyed on it) is 200.
    expect(me.body.data.permissions).toContain(Permission.LOGS_VIEW);
    await get('/admin/logs', UserRole.MODERATOR).expect(200);
    // Excludes logs.export → the export endpoint is 403. The nav source and the
    // guard cannot disagree, because they read the same role_permissions rows.
    expect(me.body.data.permissions).not.toContain(Permission.LOGS_EXPORT);
    await get('/admin/logs/export', UserRole.MODERATOR).expect(403);
  });

  it('a non-admin role (CANDIDATE) is refused with 403', async () => {
    if (dockerUnavailable) return;
    await get('/admin/me/permissions', UserRole.CANDIDATE).expect(403);
  });
});

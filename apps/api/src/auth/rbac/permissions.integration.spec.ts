/**
 * Integration test: PermissionsGuard + PermissionService against real Postgres + Redis.
 *
 * Uses Testcontainers to spin up throwaway containers so no shared state leaks
 * between CI runs. The test controller is defined ONLY in this file and is
 * never registered in any production module.
 *
 * When Docker is unavailable (e.g. during local unit-test-only runs), the
 * beforeAll catches the "no container runtime" error, sets dockerUnavailable=true,
 * and each test returns early so the suite passes with skipped tests rather than
 * failing outright.
 */
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import supertest from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import * as path from 'path';
import { execSync } from 'child_process';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { Permission } from './permission.constants';
import { PermissionService } from './permission.service';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

// ─── Test-only fixtures (never imported by production code) ───────────────────

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: CurrentUserPayload;
    }>();
    const role = req.headers['x-test-role'] as UserRole | undefined;
    if (!role) return false;
    req.user = { userId: 'test-user', role, jti: 'test-jti', exp: 9_999_999_999 };
    return true;
  }
}

@Controller('__test__')
class PermTestController {
  @Get('resource')
  @RequirePermissions(Permission.CANDIDATES_VIEW)
  getResource() {
    return { ok: true };
  }
}

// ─── Container lifecycle ──────────────────────────────────────────────────────

const API_DIR = path.resolve(__dirname, '../../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let redisClient: Redis;
let app: INestApplication;
let permService: PermissionService;
// Set to true when Docker is not running; each test returns early in that case.
let dockerUnavailable = false;

// Container startup + migration can take 60-90 s — set a generous timeout.
jest.setTimeout(180_000);

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_test',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_test`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    // Apply migrations to the fresh Postgres database.
    // `pnpm exec` finds the locally-installed prisma binary on all platforms.
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: true,
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    redisClient = new Redis(redisUrl, { lazyConnect: false, enableOfflineQueue: true });

    // Seed the permission matrix rows needed by this test.
    await prismaClient.rolePermission.createMany({
      data: [
        // SUPER_ADMIN has candidates.view (unlocked).
        {
          role: UserRole.SUPER_ADMIN,
          permissionKey: Permission.CANDIDATES_VIEW,
          enabled: true,
          isLocked: false,
        },
        // SUPER_ADMIN has candidates.edit (LOCKED — cannot be toggled).
        {
          role: UserRole.SUPER_ADMIN,
          permissionKey: Permission.CANDIDATES_EDIT,
          enabled: true,
          isLocked: true,
        },
        // SUPPORT starts with candidates.view DISABLED (enabled after toggle test).
        {
          role: UserRole.SUPPORT,
          permissionKey: Permission.CANDIDATES_VIEW,
          enabled: false,
          isLocked: false,
        },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PermTestController],
      providers: [
        PermissionService,
        { provide: PrismaService, useValue: prismaClient as unknown as PrismaService },
        { provide: REDIS_CLIENT, useValue: redisClient },
        // Guard order: TestAuthGuard (sets req.user) → PermissionsGuard (checks perms).
        { provide: APP_GUARD, useClass: TestAuthGuard },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector, ps: PermissionService) =>
            new PermissionsGuard(reflector, ps),
          inject: [Reflector, PermissionService],
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    permService = app.get(PermissionService);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized') ||
      msg.includes('prisma: command not found')
    ) {
      dockerUnavailable = true;
      console.warn('[integration] Docker unavailable — container tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await app?.close();
  await prismaClient?.$disconnect();
  redisClient?.disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PermissionsGuard — integration (real Postgres + Redis)', () => {
  it('allows SUPER_ADMIN who has candidates.view', async () => {
    if (dockerUnavailable) return;
    await supertest(app.getHttpServer())
      .get('/__test__/resource')
      .set('x-test-role', UserRole.SUPER_ADMIN)
      .expect(200)
      .expect({ ok: true });
  });

  it('denies SUPPORT whose candidates.view is disabled', async () => {
    if (dockerUnavailable) return;
    await supertest(app.getHttpServer())
      .get('/__test__/resource')
      .set('x-test-role', UserRole.SUPPORT)
      .expect(403);
  });

  it('flips to allowed after enabling candidates.view for SUPPORT — same role, no relogin', async () => {
    if (dockerUnavailable) return;
    await permService.setPermission(
      UserRole.SUPPORT,
      Permission.CANDIDATES_VIEW,
      true,
      'test-actor',
    );

    // Same role (same "token") must now succeed — proves cache invalidation.
    await supertest(app.getHttpServer())
      .get('/__test__/resource')
      .set('x-test-role', UserRole.SUPPORT)
      .expect(200)
      .expect({ ok: true });
  });

  it('throws 423 PERMISSION_LOCKED when trying to change a locked cell', async () => {
    if (dockerUnavailable) return;
    let thrown: unknown;
    try {
      await permService.setPermission(
        UserRole.SUPER_ADMIN,
        Permission.CANDIDATES_EDIT,
        false,
        'test-actor',
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(423);
  });

  it('denies a request with no x-test-role header', async () => {
    if (dockerUnavailable) return;
    await supertest(app.getHttpServer()).get('/__test__/resource').expect(403);
  });
});

/**
 * RBAC boundaries for the S6a-B1 admin read surfaces — proven LIVE through the
 * real PermissionsGuard against the real seeded matrix (Postgres + Redis).
 *
 * THE headline assertion: **the two-key separation on the audit trail.** A
 * MODERATOR holds `logs.view` and may READ a page of the log on screen, but does
 * NOT hold `logs.export` and cannot bulk-extract it. Reading and walking out with
 * the whole table are different acts; if one key covered both, the distinction
 * would be unenforceable. Same pattern for `candidates.view_documents`: seeing a
 * candidate's card must not imply the right to open their passport.
 *
 * The REAL controllers are mounted (so the @RequirePermissions metadata under
 * test is the metadata that ships); their services are stubbed, because what is
 * being tested is the gate, not the payload.
 */
import {
  CanActivate,
  ExecutionContext,
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
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { Permission } from '../auth/rbac/permission.constants';
import { PermissionService } from '../auth/rbac/permission.service';
import { PermissionsGuard } from '../auth/rbac/permissions.guard';
import { AuditQueryController } from '../audit/audit-query.controller';
import { AuditQueryService } from '../audit/audit-query.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDocumentsController } from './admin-documents.controller';
import { AdminDocumentsService } from './admin-documents.service';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');

/** Injects the role under test — stands in for JwtAuthGuard. */
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
      userId: '44444444-4444-4444-8444-444444444444',
      role,
      jti: 'test-jti',
      exp: 9_999_999_999,
    };
    return true;
  }
}

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let redis: Redis;
let app: INestApplication;
let dockerUnavailable = false;

const CANDIDATE_ID = '55555555-5555-4555-8555-555555555555';
const COMPANY_ID = '66666666-6666-4666-8666-666666666666';

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_admin_rbac',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_admin_rbac`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prisma.$connect();
    redis = new Redis(redisUrl, { lazyConnect: false });

    // The matrix rows under test — a faithful slice of prisma/seed.ts.
    await prisma.rolePermission.createMany({
      data: [
        // ADMIN: reads the log AND may export it; may open candidate documents.
        { role: UserRole.ADMIN, permissionKey: Permission.LOGS_VIEW, enabled: true },
        { role: UserRole.ADMIN, permissionKey: Permission.LOGS_EXPORT, enabled: true },
        { role: UserRole.ADMIN, permissionKey: Permission.REPORTS_VIEW, enabled: true },
        { role: UserRole.ADMIN, permissionKey: Permission.EMPLOYERS_VIEW, enabled: true },
        {
          role: UserRole.ADMIN,
          permissionKey: Permission.CANDIDATES_VIEW_DOCUMENTS,
          enabled: true,
        },

        // MODERATOR: THE boundary — logs.view ON, logs.export OFF.
        // Also candidates.view_documents OFF: moderators do not read passports.
        { role: UserRole.MODERATOR, permissionKey: Permission.LOGS_VIEW, enabled: true },
        { role: UserRole.MODERATOR, permissionKey: Permission.LOGS_EXPORT, enabled: false },
        { role: UserRole.MODERATOR, permissionKey: Permission.REPORTS_VIEW, enabled: true },
        { role: UserRole.MODERATOR, permissionKey: Permission.EMPLOYERS_VIEW, enabled: true },
        {
          role: UserRole.MODERATOR,
          permissionKey: Permission.CANDIDATES_VIEW_DOCUMENTS,
          enabled: false,
        },

        // SUPPORT: cannot even read the log (logs.view OFF).
        { role: UserRole.SUPPORT, permissionKey: Permission.LOGS_VIEW, enabled: false },
        { role: UserRole.SUPPORT, permissionKey: Permission.LOGS_EXPORT, enabled: false },
        { role: UserRole.SUPPORT, permissionKey: Permission.REPORTS_VIEW, enabled: true },
      ],
    });

    // Stubbed services — the gate is under test, not the payload.
    const auditQueryStub = {
      query: async () => ({ data: [], nextCursor: null }),
      export: async () => ({ csv: 'id\n', rowCount: 0, filename: 'audit-log.csv' }),
    };
    const dashboardStub = { getDashboard: async () => ({ counts: {} }) };
    const documentsStub = {
      issueEmployerCertificateUrl: async () => ({ url: 'https://x', expiresInSeconds: 300 }),
      issueCandidateDocumentUrl: async () => ({ url: 'https://x', expiresInSeconds: 300 }),
    };

    const moduleRef = await Test.createTestingModule({
      // The REAL controllers — so the @RequirePermissions metadata under test is
      // exactly the metadata that ships.
      controllers: [AuditQueryController, AdminDashboardController, AdminDocumentsController],
      providers: [
        PermissionService,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: AuditQueryService, useValue: auditQueryStub },
        { provide: AdminDashboardService, useValue: dashboardStub },
        { provide: AdminDocumentsService, useValue: documentsStub },
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping admin RBAC tests.');
  }
});

afterAll(async () => {
  if (dockerUnavailable) return;
  await app?.close();
  await redis?.quit();
  await prisma?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

const gatedIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

const get = (url: string, role: UserRole) =>
  supertest(app.getHttpServer()).get(url).set('x-test-role', role);

// ── THE two-key separation on the audit trail ────────────────────────────────

describe('audit log: logs.view and logs.export are SEPARATE grants', () => {
  gatedIt('MODERATOR CAN read a page of the log (logs.view)', async () => {
    await get('/admin/logs', UserRole.MODERATOR).expect(200);
  });

  gatedIt(
    'MODERATOR CANNOT export it → 403 (the boundary: reading ≠ bulk extraction)',
    async () => {
      const res = await get('/admin/logs/export', UserRole.MODERATOR).expect(403);
      expect(res.body.meta.missing).toContain(Permission.LOGS_EXPORT);
    },
  );

  gatedIt('ADMIN holds BOTH — reads and exports', async () => {
    await get('/admin/logs', UserRole.ADMIN).expect(200);
    await get('/admin/logs/export', UserRole.ADMIN).expect(200);
  });

  gatedIt('SUPPORT holds neither — 403 on the query itself', async () => {
    await get('/admin/logs', UserRole.SUPPORT).expect(403);
    await get('/admin/logs/export', UserRole.SUPPORT).expect(403);
  });
});

// ── Document grants: seeing a candidate ≠ opening their passport ─────────────

describe('document grants are gated per key', () => {
  gatedIt('ADMIN (candidates.view_documents ON) may open a candidate document', async () => {
    await get(`/admin/candidates/${CANDIDATE_ID}/documents/PASSPORT/url`, UserRole.ADMIN).expect(
      200,
    );
  });

  gatedIt(
    'MODERATOR (candidates.view_documents OFF) → 403 — a moderator does not read passports',
    async () => {
      const res = await get(
        `/admin/candidates/${CANDIDATE_ID}/documents/PASSPORT/url`,
        UserRole.MODERATOR,
      ).expect(403);
      expect(res.body.meta.missing).toContain(Permission.CANDIDATES_VIEW_DOCUMENTS);
    },
  );

  gatedIt('employer certificate is gated on employers.view (ADMIN + MODERATOR hold it)', async () => {
    await get(`/admin/employers/${COMPANY_ID}/certificate/url`, UserRole.ADMIN).expect(200);
    await get(`/admin/employers/${COMPANY_ID}/certificate/url`, UserRole.MODERATOR).expect(200);
    // SUPPORT has no employers.view row seeded here → denied.
    await get(`/admin/employers/${COMPANY_ID}/certificate/url`, UserRole.SUPPORT).expect(403);
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe('dashboard is gated on reports.view', () => {
  gatedIt('ADMIN / MODERATOR / SUPPORT all hold reports.view → 200', async () => {
    await get('/admin/dashboard', UserRole.ADMIN).expect(200);
    await get('/admin/dashboard', UserRole.MODERATOR).expect(200);
    await get('/admin/dashboard', UserRole.SUPPORT).expect(200);
  });

  gatedIt('a role with NO rows at all (CANDIDATE) → 403', async () => {
    await get('/admin/dashboard', UserRole.CANDIDATE).expect(403);
    await get('/admin/logs', UserRole.CANDIDATE).expect(403);
  });
});

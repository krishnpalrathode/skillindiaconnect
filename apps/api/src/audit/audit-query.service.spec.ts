/**
 * The audit READ side (S6a-B1) on real Postgres (Testcontainers).
 *
 * The centrepiece is the keyset-completeness proof: walking every page must
 * yield every row EXACTLY ONCE — including while new rows are being inserted
 * mid-walk. That is the whole reason the query is keyset-on-BigInt-PK rather
 * than OFFSET, so it gets proven, not asserted.
 *
 * Real AuditService (so the export's self-audit row is a real insert). Skips
 * gracefully when Docker is unavailable.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { AuditStatus, PrismaClient, UserRole } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuditQueryService } from './audit-query.service';
import { DEFAULT_WINDOW_DAYS, EXPORT_MAX_ROWS } from './dto/log-query.dto';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: AuditQueryService;
let dockerUnavailable = false;

const ACTOR = { userId: '11111111-1111-4111-8111-111111111111', role: UserRole.SUPER_ADMIN };

/** Insert n rows directly (bypassing AuditService) for bulk fixture speed. */
async function seedRows(
  n: number,
  overrides: Partial<{
    module: string;
    action: string;
    status: AuditStatus;
    createdAt: Date;
    actorUserId: string;
    targetId: string;
  }> = {},
): Promise<void> {
  await prisma.auditLog.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      module: overrides.module ?? 'Jobs',
      action: overrides.action ?? `job.action.${i}`,
      status: overrides.status ?? AuditStatus.SUCCESS,
      createdAt: overrides.createdAt ?? new Date(),
      actorUserId: overrides.actorUserId ?? null,
      targetId: overrides.targetId ?? null,
      meta: {},
    })),
  });
}

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_audit_query',
      })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_audit_query`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const prismaSvc = prisma as unknown as PrismaService;
    service = new AuditQueryService(prismaSvc, new AuditService(prismaSvc));
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping audit-query tests.');
  }
});

afterAll(async () => {
  if (dockerUnavailable) return;
  await prisma.$disconnect();
  await pg.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  await prisma.auditLog.deleteMany();
});

const gatedIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

// ── Keyset pagination — the completeness proof ───────────────────────────────

describe('keyset pagination on the BigInt PK', () => {
  gatedIt(
    'walking every page yields every row EXACTLY once (no skips, no duplicates)',
    async () => {
      await seedRows(250);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const page = await service.query({ limit: 40, ...(cursor && { cursor }) });
        seen.push(...page.data.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
        pages++;
        expect(pages).toBeLessThan(20); // guard against an infinite walk
      } while (cursor);

      expect(seen).toHaveLength(250);
      expect(new Set(seen).size).toBe(250); // every id distinct — no duplicates
      // …and strictly descending, which is what makes the cursor sound.
      const ids = seen.map((s) => BigInt(s));
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]! < ids[i - 1]!).toBe(true);
      }
    },
  );

  gatedIt(
    'CONCURRENT INSERTS during the walk never skip or duplicate a pre-existing row',
    async () => {
      await seedRows(120);
      const originalIds = new Set(
        (await prisma.auditLog.findMany({ select: { id: true } })).map((r) => String(r.id)),
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await service.query({ limit: 25, ...(cursor && { cursor }) });
        seen.push(...page.data.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
        // A writer is hammering the table mid-walk. New rows get HIGHER ids, so
        // they land ahead of the descending walk and can never be interleaved
        // into it — the exact property OFFSET does not have.
        await seedRows(10, { module: 'Payments' });
      } while (cursor);

      // Every original row was seen exactly once…
      const seenOriginals = seen.filter((id) => originalIds.has(id));
      expect(new Set(seenOriginals).size).toBe(120);
      // …and nothing at all was duplicated.
      expect(new Set(seen).size).toBe(seen.length);
    },
  );

  gatedIt('nextCursor is null at exhaustion', async () => {
    await seedRows(5);
    const page = await service.query({ limit: 50 });
    expect(page.data).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  gatedIt(
    'BigInt ids serialize as STRINGS (JSON.stringify would throw on raw BigInt)',
    async () => {
      await seedRows(1);
      const page = await service.query({});
      expect(typeof page.data[0]!.id).toBe('string');
      // The real proof: the response survives serialization.
      expect(() => JSON.stringify(page)).not.toThrow();
    },
  );
});

// ── The bounded default window ───────────────────────────────────────────────

describe('the bounded default window', () => {
  gatedIt(
    `no date range → only the last ${DEFAULT_WINDOW_DAYS} days (an unfiltered Screen 29 must not scan the trail)`,
    async () => {
      await seedRows(3, { createdAt: daysAgo(1) }); // inside
      await seedRows(4, { createdAt: daysAgo(90) }); // outside the default window

      const page = await service.query({});
      expect(page.data).toHaveLength(3);
    },
  );

  gatedIt('an EXPLICIT wider range reaches the older rows', async () => {
    await seedRows(3, { createdAt: daysAgo(1) });
    await seedRows(4, { createdAt: daysAgo(90) });

    const page = await service.query({ from: daysAgo(365).toISOString() });
    expect(page.data).toHaveLength(7);
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe('filters (all on structured columns)', () => {
  gatedIt('module / action / actor / target / status each narrow correctly', async () => {
    const actorA = '22222222-2222-4222-8222-222222222222';
    await seedRows(2, { module: 'Payments', action: 'payment.captured' });
    await seedRows(3, { module: 'Jobs', action: 'job.published' });
    await seedRows(1, { module: 'Auth', status: AuditStatus.FAILED });
    await seedRows(1, { module: 'Admin', actorUserId: actorA, targetId: 'target-xyz' });

    expect((await service.query({ module: 'Payments' })).data).toHaveLength(2);
    expect((await service.query({ action: 'job.published' })).data).toHaveLength(3);
    expect((await service.query({ status: AuditStatus.FAILED })).data).toHaveLength(1);
    expect((await service.query({ actorId: actorA })).data).toHaveLength(1);
    expect((await service.query({ targetId: 'target-xyz' })).data).toHaveLength(1);
  });

  gatedIt('date range narrows to the window', async () => {
    await seedRows(2, { createdAt: daysAgo(2) });
    await seedRows(3, { createdAt: daysAgo(20) });

    const page = await service.query({
      from: daysAgo(5).toISOString(),
      to: new Date().toISOString(),
    });
    expect(page.data).toHaveLength(2);
  });

  gatedIt('q matches STRUCTURED columns (action/targetId) — never the meta JSON', async () => {
    await seedRows(1, { action: 'subscription.activated' });
    await seedRows(1, { action: 'job.published', targetId: 'sub-target' });
    // A row whose ONLY mention of "subscription" is inside meta — it must NOT match,
    // because meta is not searched (that would be a full-table scan).
    await prisma.auditLog.create({
      data: {
        module: 'Payments',
        action: 'unrelated.action',
        status: AuditStatus.SUCCESS,
        meta: { note: 'subscription mentioned only in meta' },
      },
    });

    const page = await service.query({ q: 'sub' });
    const actions = page.data.map((r) => r.action);
    expect(actions).toContain('subscription.activated');
    expect(actions).toContain('job.published'); // matched via targetId
    expect(actions).not.toContain('unrelated.action'); // meta is NOT searched
  });

  gatedIt(
    'meta is returned EXACTLY as stored (B2 owns redaction; we do not re-apply it)',
    async () => {
      await prisma.auditLog.create({
        data: {
          module: 'Payments',
          action: 'subscription.activated',
          status: AuditStatus.SUCCESS,
          meta: { planCode: 'PRO_MONTHLY', count: 3 },
        },
      });
      const page = await service.query({});
      expect(page.data[0]!.meta).toEqual({ planCode: 'PRO_MONTHLY', count: 3 });
    },
  );
});

// ── The export ───────────────────────────────────────────────────────────────

describe('export — bounded and self-auditing', () => {
  gatedIt('produces CSV with a header and one line per row', async () => {
    await seedRows(3, { module: 'Payments' });

    const { csv, rowCount } = await service.export({ module: 'Payments' }, ACTOR);

    expect(rowCount).toBe(3);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'id,createdAt,module,action,actorUserId,actorRole,targetType,targetId,status,meta',
    );
    expect(lines).toHaveLength(4); // header + 3
  });

  gatedIt('WRITES ITS OWN audit row (the meta-trail: who extracted what, when)', async () => {
    await seedRows(2, { module: 'Jobs' });

    await service.export({ module: 'Jobs', status: AuditStatus.SUCCESS }, ACTOR);

    const selfAudit = await prisma.auditLog.findFirst({
      where: { action: 'audit.exported' },
      orderBy: { id: 'desc' },
    });
    expect(selfAudit).not.toBeNull();
    expect(selfAudit!.actorUserId).toBe(ACTOR.userId);
    expect(selfAudit!.actorRole).toBe(UserRole.SUPER_ADMIN);
    // The row count AND the filter fingerprint — "what did they take?" is answerable.
    expect(selfAudit!.meta).toMatchObject({
      rowCount: 2,
      filters: { module: 'Jobs', status: 'SUCCESS' },
    });
  });

  gatedIt(`over the ${EXPORT_MAX_ROWS}-row cap → 422 EXPORT_TOO_LARGE`, async () => {
    // Cheaper than seeding 10k rows: assert the guard by driving the count over
    // the cap with a stubbed count on a service sharing the same prisma client.
    const overCap = new AuditQueryService(
      {
        ...(prisma as unknown as PrismaService),
        auditLog: {
          ...prisma.auditLog,
          count: async () => EXPORT_MAX_ROWS + 1,
        },
      } as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
    );

    await expect(overCap.export({}, ACTOR)).rejects.toThrow(UnprocessableEntityException);
    try {
      await overCap.export({}, ACTOR);
    } catch (e) {
      const body = (e as UnprocessableEntityException).getResponse() as Record<string, unknown>;
      expect(body['code']).toBe('EXPORT_TOO_LARGE');
    }
  });

  gatedIt(
    'over the date-range cap → 422 EXPORT_TOO_LARGE (and no rows are materialized)',
    async () => {
      await expect(
        service.export({ from: daysAgo(365).toISOString(), to: new Date().toISOString() }, ACTOR),
      ).rejects.toThrow(UnprocessableEntityException);
    },
  );
});

/**
 * Integration tests for SettingsService against real Postgres + Redis
 * (Testcontainers). When Docker is unavailable the suite passes with skipped tests.
 *
 * Safety-critical test: cache invalidation on set.
 * After a set(), the next get() must return the NEW value — not the stale cached one.
 * A stale worker-protection rule would let a non-compliant job publish.
 */
import {
  ForbiddenException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { SETTING_KEYS, SettingType } from './settings.keys';
import { SettingsService, SETTINGS_CACHE_TTL_SECONDS } from './settings.service';

const API_DIR = path.resolve(__dirname, '../../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let redisClient: Redis;
let moduleRef: TestingModule;
let service: SettingsService;
let emitter: EventEmitter2;
let dockerUnavailable = false;

jest.setTimeout(180_000);

const SUPER_ADMIN_ACTOR = { userId: 'super-1', role: UserRole.SUPER_ADMIN };
const ADMIN_ACTOR = { userId: 'admin-1', role: UserRole.ADMIN };

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_test' })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_test`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    // Seed the 12 settings rows (mirrors prisma/seed.ts step 1)
    const rows: Array<[string, unknown, boolean]> = [
      ['worker_protection.accommodation_required', true, true],
      ['worker_protection.health_insurance_required', true, true],
      ['worker_protection.transportation_required', true, true],
      ['jobs.auto_archive_days', 90, false],
      ['jobs.require_admin_approval', false, false],
      ['jobs.free_max_active_jobs', 1, false],
      ['jobs.allow_local', true, false],
      ['jobs.allow_foreign', true, false],
      ['candidates.mandatory_documents', ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'], false],
      ['candidates.min_completion_pct', 70, false],
      ['candidates.video_max_minutes', 5, false],
      ['candidates.video_max_mb', 500, false],
    ];
    for (const [key, value, isCoreRule] of rows) {
      await prismaClient.setting.upsert({
        where: { key },
        create: { key, value: value as never, isCoreRule },
        update: { value: value as never, isCoreRule },
      });
    }

    redisClient = new Redis(redisUrl, { lazyConnect: false, enableOfflineQueue: true });

    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prismaClient as unknown as PrismaService },
        { provide: REDIS_CLIENT, useValue: redisClient },
      ],
    }).compile();

    await moduleRef.init();
    service = moduleRef.get(SettingsService);
    emitter = moduleRef.get(EventEmitter2);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED')
    ) {
      dockerUnavailable = true;
      console.warn('[settings-integration] Docker unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterEach(async () => {
  if (dockerUnavailable) return;
  // Flush Redis between tests so cache state does not bleed across cases
  await redisClient.flushdb();
  // Reset settings to seed values so tests are independent
  await prismaClient.setting.updateMany({
    where: { key: 'candidates.min_completion_pct' },
    data: { value: 70 as never, version: 1 },
  });
  await prismaClient.setting.updateMany({
    where: { key: 'worker_protection.accommodation_required' },
    data: { value: true as never, version: 1 },
  });
  await prismaClient.setting.updateMany({
    where: { key: 'candidates.mandatory_documents' },
    data: { value: ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'] as never, version: 1 },
  });
});

afterAll(async () => {
  await moduleRef?.close();
  await prismaClient?.$disconnect();
  redisClient?.disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

// ─── get: read-through cache ──────────────────────────────────────────────────

describe('SettingsService.get — cache read-through', () => {
  it('returns the correct typed number value from DB on first call', async () => {
    if (dockerUnavailable) return;
    const val = await service.get(SETTING_KEYS.MIN_COMPLETION_PCT);
    expect(typeof val).toBe('number');
    expect(val).toBe(70);
  });

  it('second call within TTL is served from cache (no DB hit)', async () => {
    if (dockerUnavailable) return;
    await service.get(SETTING_KEYS.MIN_COMPLETION_PCT); // populates cache
    const getSpy = jest.spyOn(prismaClient.setting, 'findUniqueOrThrow');
    await service.get(SETTING_KEYS.MIN_COMPLETION_PCT);
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('returns the correct typed boolean value', async () => {
    if (dockerUnavailable) return;
    const val = await service.get(SETTING_KEYS.ACCOMMODATION_REQUIRED);
    expect(typeof val).toBe('boolean');
    expect(val).toBe(true);
  });

  it('returns the correct typed string[] value', async () => {
    if (dockerUnavailable) return;
    const val = await service.get(SETTING_KEYS.MANDATORY_DOCUMENTS);
    expect(Array.isArray(val)).toBe(true);
    expect(val).toEqual(['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT']);
  });

  it('throws SETTING_TYPE_MISMATCH if stored DB value has wrong type', async () => {
    if (dockerUnavailable) return;
    // Corrupt the row with a wrong type (store a string where number is expected)
    await prismaClient.setting.update({
      where: { key: 'candidates.min_completion_pct' },
      data: { value: 'not-a-number' as never },
    });
    await expect(service.get(SETTING_KEYS.MIN_COMPLETION_PCT)).rejects.toThrow(
      InternalServerErrorException,
    );
    // Restore
    await prismaClient.setting.update({
      where: { key: 'candidates.min_completion_pct' },
      data: { value: 70 as never },
    });
  });

  it('throws SETTING_TYPE_MISMATCH if cached value has wrong type', async () => {
    if (dockerUnavailable) return;
    // Manually push a corrupt value into Redis to simulate cache corruption
    await redisClient.setex(
      `settings:${SETTING_KEYS.MIN_COMPLETION_PCT.key}`,
      SETTINGS_CACHE_TTL_SECONDS,
      JSON.stringify('corrupt-string'),
    );
    await expect(service.get(SETTING_KEYS.MIN_COMPLETION_PCT)).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});

// ─── set: core-rule gate ──────────────────────────────────────────────────────

describe('SettingsService.set — core-rule gate', () => {
  it('ADMIN cannot update a core-rule key → 403 CORE_RULE_FORBIDDEN', async () => {
    if (dockerUnavailable) return;
    await expect(
      service.set(SETTING_KEYS.ACCOMMODATION_REQUIRED, false, ADMIN_ACTOR),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN can update a core-rule key', async () => {
    if (dockerUnavailable) return;
    const result = await service.set(SETTING_KEYS.ACCOMMODATION_REQUIRED, false, SUPER_ADMIN_ACTOR);
    expect(result.value).toBe(false);
    expect(result.updatedById).toBe(SUPER_ADMIN_ACTOR.userId);
  });

  it('ADMIN can update a non-core key', async () => {
    if (dockerUnavailable) return;
    const result = await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 80, ADMIN_ACTOR);
    expect(result.value).toBe(80);
    expect(result.updatedById).toBe(ADMIN_ACTOR.userId);
  });

  it('set bumps version by 1', async () => {
    if (dockerUnavailable) return;
    const before = await prismaClient.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.MIN_COMPLETION_PCT.key },
    });
    await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 75, ADMIN_ACTOR);
    const after = await prismaClient.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.MIN_COMPLETION_PCT.key },
    });
    expect(after.version).toBe(before.version + 1);
  });

  it('set records updatedById', async () => {
    if (dockerUnavailable) return;
    await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 75, ADMIN_ACTOR);
    const row = await prismaClient.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.MIN_COMPLETION_PCT.key },
    });
    expect(row.updatedById).toBe(ADMIN_ACTOR.userId);
  });
});

// ─── set: type validation ─────────────────────────────────────────────────────

describe('SettingsService.set — type validation', () => {
  it('rejects a string value for a number key → 422 SETTING_INVALID_VALUE', async () => {
    if (dockerUnavailable) return;
    await expect(
      service.set(
        SETTING_KEYS.MIN_COMPLETION_PCT,
        'not-a-number' as unknown as number,
        ADMIN_ACTOR,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a number value for a boolean key → 422', async () => {
    if (dockerUnavailable) return;
    await expect(
      service.set(
        SETTING_KEYS.REQUIRE_ADMIN_APPROVAL,
        42 as unknown as boolean,
        ADMIN_ACTOR,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a non-string-array for a string[] key → 422', async () => {
    if (dockerUnavailable) return;
    await expect(
      service.set(
        SETTING_KEYS.MANDATORY_DOCUMENTS,
        [1, 2, 3] as unknown as string[],
        ADMIN_ACTOR,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('no DB write happens on validation failure', async () => {
    if (dockerUnavailable) return;
    const before = await prismaClient.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.MIN_COMPLETION_PCT.key },
    });
    try {
      await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 'bad' as unknown as number, ADMIN_ACTOR);
    } catch {
      // expected
    }
    const after = await prismaClient.setting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.MIN_COMPLETION_PCT.key },
    });
    expect(after.version).toBe(before.version);
  });
});

// ─── set: SAFETY-CRITICAL cache invalidation ─────────────────────────────────

describe('SettingsService.set — cache invalidation (SAFETY-CRITICAL)', () => {
  it('after set(), get() returns the NEW value immediately (stale cache is gone)', async () => {
    if (dockerUnavailable) return;
    // Warm the cache with the old value
    const oldVal = await service.get(SETTING_KEYS.MIN_COMPLETION_PCT);
    expect(oldVal).toBe(70);

    // Write a new value
    await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 85, ADMIN_ACTOR);

    // The cache key must be absent
    const cached = await redisClient.get(`settings:${SETTING_KEYS.MIN_COMPLETION_PCT.key}`);
    expect(cached).toBeNull();

    // get() must return the new value (re-reads DB, not stale cache)
    const newVal = await service.get(SETTING_KEYS.MIN_COMPLETION_PCT);
    expect(newVal).toBe(85);
  });

  it('same invalidation applies to a core-rule boolean setting', async () => {
    if (dockerUnavailable) return;
    const oldVal = await service.get(SETTING_KEYS.ACCOMMODATION_REQUIRED);
    expect(oldVal).toBe(true);

    await service.set(SETTING_KEYS.ACCOMMODATION_REQUIRED, false, SUPER_ADMIN_ACTOR);

    const cached = await redisClient.get(`settings:${SETTING_KEYS.ACCOMMODATION_REQUIRED.key}`);
    expect(cached).toBeNull();

    const newVal = await service.get(SETTING_KEYS.ACCOMMODATION_REQUIRED);
    expect(newVal).toBe(false);
  });
});

// ─── set: domain event ────────────────────────────────────────────────────────

describe('SettingsService.set — settings.changed event', () => {
  it('emits settings.changed with the key', async () => {
    if (dockerUnavailable) return;
    const received: Array<{ key: string }> = [];
    emitter.on('settings.changed', (payload: { key: string }) => {
      received.push(payload);
    });

    await service.set(SETTING_KEYS.MIN_COMPLETION_PCT, 80, ADMIN_ACTOR);

    expect(received).toHaveLength(1);
    expect(received[0]!.key).toBe(SETTING_KEYS.MIN_COMPLETION_PCT.key);
    emitter.removeAllListeners('settings.changed');
  });
});

// ─── getMany / getAll ─────────────────────────────────────────────────────────

describe('SettingsService.getMany / getAll', () => {
  it('getMany returns only the requested keys', async () => {
    if (dockerUnavailable) return;
    const rows = await service.getMany([
      SETTING_KEYS.MIN_COMPLETION_PCT,
      SETTING_KEYS.FREE_MAX_ACTIVE_JOBS,
    ]);
    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain(SETTING_KEYS.MIN_COMPLETION_PCT.key);
    expect(keys).toContain(SETTING_KEYS.FREE_MAX_ACTIVE_JOBS.key);
  });

  it('getAll returns all 12 seeded settings ordered by key', async () => {
    if (dockerUnavailable) return;
    const rows = await service.getAll();
    expect(rows.length).toBe(12);
    // Verify ordered by key ascending
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.key >= rows[i - 1]!.key).toBe(true);
    }
  });
});

// ─── isValidValue type-check helper ──────────────────────────────────────────

describe('isValidValue (unit — no containers needed)', () => {
  const { isValidValue: iv } = jest.requireActual<typeof import('./settings.keys')>(
    './settings.keys',
  );

  it.each<[SettingType, unknown, boolean]>([
    ['boolean', true, true],
    ['boolean', false, true],
    ['boolean', 1, false],
    ['boolean', 'true', false],
    ['number', 0, true],
    ['number', 42.5, true],
    ['number', Infinity, false],
    ['number', NaN, false],
    ['number', '42', false],
    ['string[]', [], true],
    ['string[]', ['a', 'b'], true],
    ['string[]', [1, 2], false],
    ['string[]', 'foo', false],
  ])('type=%s value=%p → %s', (type, value, expected) => {
    expect(iv(type, value)).toBe(expected);
  });
});

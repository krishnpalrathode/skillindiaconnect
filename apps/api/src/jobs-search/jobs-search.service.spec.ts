/**
 * Integration tests for JobsSearchService — requires REAL Postgres (FTS, pg_trgm,
 * and the generated searchVector column cannot be validated against a mock).
 *
 * Critical coverage:
 * - Only ACTIVE jobs appear in search results.
 * - FTS: q matching title/description returns the job; q not matching excludes it.
 * - Trgm typo tolerance: "electrican" finds "Electrician" (similarity > 0.3).
 * - SQL injection: a malicious q value is handled safely via bound parameters —
 *   no error, no injection; the jobs table survives.
 * - Filters: market, category slug, salary range, currency, badge (featured/urgent/new).
 * - Cursor pagination stability: pages don't skip or duplicate rows across page boundaries.
 * - GET /jobs/:id: ACTIVE job → JobDetail with public subset; no PII / internal fields.
 * - GET /jobs/:id: non-ACTIVE or unknown id → NotFoundException.
 * - Similar jobs: returns ACTIVE same-category/market jobs.
 * - Cache invalidation: bumping the version causes the next search to miss the cache
 *   and return updated results.
 */
import {
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  JobMarket,
  JobStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { JobsSearchService } from './jobs-search.service';
import { SearchCacheService } from './search-cache.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let redis: Redis;
let searchService: JobsSearchService;
let cacheService: SearchCacheService;
let dockerUnavailable = false;

const CATEGORY_ID = 'srch-cat-1';
const CATEGORY_SLUG = 'srch-electrical';
const COMPANY_ID = 'srch-co-1';
const USER_ID = 'srch-user-1';

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_search',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_search`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    redis = new Redis(redisUrl, { lazyConnect: true });
    await redis.connect();

    // Seed base data
    await prismaClient.user.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, email: 'srch-emp@example.com', role: UserRole.EMPLOYER },
      update: {},
    });
    await prismaClient.company.upsert({
      where: { id: COMPANY_ID },
      create: {
        id: COMPANY_ID,
        name: 'Search Test Co',
        type: CompanyType.FOREIGN,
        status: CompanyStatus.APPROVED,
        registrationNumber: 'REG-SRCH',
        industryType: 'Construction',
        phone: '+91111',
        location: 'Dubai',
        employeeRange: '100-500',
        description: 'A test company for search specs',
      },
      update: {},
    });
    await prismaClient.employerUser.upsert({
      where: { userId: USER_ID },
      create: { userId: USER_ID, companyId: COMPANY_ID, isPrimary: true },
      update: {},
    });
    await prismaClient.jobCategory.upsert({
      where: { id: CATEGORY_ID },
      create: {
        id: CATEGORY_ID,
        slug: CATEGORY_SLUG,
        nameEn: 'Electrical',
        nameHi: 'विद्युत',
        nameAr: 'كهربائي',
      },
      update: {},
    });

    const prismaSvc = prismaClient as unknown as PrismaService;
    cacheService = new SearchCacheService(redis as never);
    Object.defineProperty(cacheService, 'redis', { value: redis, writable: false });

    searchService = new JobsSearchService(prismaSvc, cacheService);
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
      console.warn('[jobs-search] Docker unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  if (!dockerUnavailable) {
    await redis?.quit();
    await prismaClient?.$disconnect();
  }
  await pgContainer?.stop();
  await redisContainer?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  // Clear jobs and flush Redis cache between tests
  await prismaClient.job.deleteMany();
  await redis.flushdb();
});

// ─────── Helpers ──────────────────────────────────────────────────────────────

async function createJob(opts: {
  title: string;
  description?: string;
  status?: JobStatus;
  market?: JobMarket;
  categoryId?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: Currency;
  isFeatured?: boolean;
  isUrgent?: boolean;
  publishedAt?: Date;
  accommodation?: boolean;
  healthInsurance?: boolean;
  transportation?: boolean;
}) {
  const now = new Date();
  return prismaClient.job.create({
    data: {
      companyId: COMPANY_ID,
      title: opts.title,
      description: opts.description ?? 'Test description',
      status: opts.status ?? JobStatus.ACTIVE,
      market: opts.market ?? JobMarket.FOREIGN,
      location: 'Dubai',
      categoryId: opts.categoryId ?? CATEGORY_ID,
      employmentType: EmploymentType.FULL_TIME,
      salaryMin: opts.salaryMin ?? 50000,
      salaryMax: opts.salaryMax ?? 80000,
      currency: opts.currency ?? Currency.AED,
      accommodation: opts.accommodation ?? true,
      healthInsurance: opts.healthInsurance ?? true,
      transportation: opts.transportation ?? true,
      hoursPerDay: 8,
      daysPerWeek: 6,
      isFeatured: opts.isFeatured ?? false,
      isUrgent: opts.isUrgent ?? false,
      publishedAt: opts.status === JobStatus.ACTIVE ? (opts.publishedAt ?? now) : null,
      autoArchiveAt: opts.status === JobStatus.ACTIVE
        ? new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
        : null,
    },
  });
}

// ─────── Tests ────────────────────────────────────────────────────────────────

describe('JobsSearchService (integration)', () => {

  // ── 1. Only ACTIVE jobs ─────────────────────────────────────────────────────

  it('returns only ACTIVE jobs — DRAFT/PAUSED/ARCHIVED are hidden', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'ACTIVE Job' });
    await createJob({ title: 'DRAFT Job', status: JobStatus.DRAFT });
    await createJob({ title: 'PAUSED Job', status: JobStatus.PAUSED });
    await createJob({ title: 'ARCHIVED Job', status: JobStatus.ARCHIVED });

    const result = await searchService.search({});
    expect(result.data.every((j) => j.title !== 'DRAFT Job')).toBe(true);
    expect(result.data.every((j) => j.title !== 'PAUSED Job')).toBe(true);
    expect(result.data.every((j) => j.title !== 'ARCHIVED Job')).toBe(true);
    expect(result.data.some((j) => j.title === 'ACTIVE Job')).toBe(true);
  });

  // ── 2. FTS matching ─────────────────────────────────────────────────────────

  it('FTS: q matching title returns the job; non-matching q excludes it', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Senior Electrician', description: 'Wire installation expert' });
    await createJob({ title: 'Plumber', description: 'Pipe fitting specialist' });

    // Wait briefly for searchVector to be computed (it is DB-generated on insert)
    const result = await searchService.search({ q: 'electrician' });

    expect(result.data.some((j) => j.title === 'Senior Electrician')).toBe(true);
    expect(result.data.every((j) => j.title !== 'Plumber')).toBe(true);
  });

  // ── 3. Trgm typo tolerance ──────────────────────────────────────────────────

  it('trgm: "electrican" (typo) finds "Electrician" via similarity > 0.3', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Electrician', description: 'Electrical work' });

    const result = await searchService.search({ q: 'electrican' });
    expect(result.data.some((j) => j.title === 'Electrician')).toBe(true);
  });

  // ── 4. SQL injection safety ─────────────────────────────────────────────────

  it('SQL injection: malicious q is bound-parameterized — no error, table survives', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Safe Job' });

    // This would break tsquery syntax if interpolated; bound param makes it safe
    const maliciousQ = "'; DROP TABLE jobs; --";

    await expect(searchService.search({ q: maliciousQ })).resolves.toBeDefined();

    // The jobs table must still exist and contain the row we seeded
    const count = await prismaClient.job.count();
    expect(count).toBeGreaterThan(0);
  });

  // ── 5. Market filter ────────────────────────────────────────────────────────

  it('market filter narrows results correctly', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Foreign Job', market: JobMarket.FOREIGN });
    await createJob({ title: 'Local Job', market: JobMarket.LOCAL });

    const foreignResult = await searchService.search({ market: JobMarket.FOREIGN });
    expect(foreignResult.data.every((j) => j.market === JobMarket.FOREIGN)).toBe(true);
    expect(foreignResult.data.every((j) => j.title !== 'Local Job')).toBe(true);
  });

  // ── 6. Category slug filter ─────────────────────────────────────────────────

  it('category slug filter returns only jobs in that category', async () => {
    if (dockerUnavailable) return;

    const otherCat = await prismaClient.jobCategory.upsert({
      where: { id: 'srch-cat-other' },
      create: { id: 'srch-cat-other', slug: 'other-cat', nameEn: 'Other' },
      update: {},
    });
    await createJob({ title: 'Electrical Job', categoryId: CATEGORY_ID });
    await createJob({ title: 'Other Job', categoryId: otherCat.id });

    const result = await searchService.search({ category: CATEGORY_SLUG });
    expect(result.data.every((j) => j.title !== 'Other Job')).toBe(true);
    expect(result.data.some((j) => j.title === 'Electrical Job')).toBe(true);
  });

  // ── 7. Salary range filter ──────────────────────────────────────────────────

  it('salary range filter narrows results', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'High Salary', salaryMin: 100000, salaryMax: 150000, currency: Currency.AED });
    await createJob({ title: 'Low Salary', salaryMin: 10000, salaryMax: 20000, currency: Currency.AED });

    // salaryMax >= 90000 (overlap: only "High Salary" qualifies)
    const result = await searchService.search({ salaryMin: 90000, currency: Currency.AED });
    expect(result.data.some((j) => j.title === 'High Salary')).toBe(true);
    expect(result.data.every((j) => j.title !== 'Low Salary')).toBe(true);
  });

  // ── 8. Badge filter ─────────────────────────────────────────────────────────

  it('badge=featured returns only featured jobs', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Featured Job', isFeatured: true });
    await createJob({ title: 'Normal Job', isFeatured: false });

    const result = await searchService.search({ badge: 'featured' });
    expect(result.data.every((j) => j.isFeatured === true)).toBe(true);
    expect(result.data.every((j) => j.title !== 'Normal Job')).toBe(true);
  });

  it('badge=urgent returns only urgent jobs', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Urgent Job', isUrgent: true });
    await createJob({ title: 'Regular Job', isUrgent: false });

    const result = await searchService.search({ badge: 'urgent' });
    expect(result.data.every((j) => j.isUrgent === true)).toBe(true);
  });

  // ── 9. Cursor pagination stability ─────────────────────────────────────────

  it('cursor pagination: no rows skipped or duplicated across pages (recent sort)', async () => {
    if (dockerUnavailable) return;

    const now = Date.now();
    await createJob({ title: 'Job A', publishedAt: new Date(now - 3000) });
    await createJob({ title: 'Job B', publishedAt: new Date(now - 2000) });
    await createJob({ title: 'Job C', publishedAt: new Date(now - 1000) });

    const page1 = await searchService.search({ sort: 'recent', limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await searchService.search({ sort: 'recent', limit: 1, cursor: page1.nextCursor! });
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await searchService.search({ sort: 'recent', limit: 1, cursor: page2.nextCursor! });
    expect(page3.data).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [page1.data[0]!.id, page2.data[0]!.id, page3.data[0]!.id];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(3); // no duplicates
    expect(allIds).toHaveLength(3); // no skips (we seeded exactly 3)
  });

  // ── 10. GET /jobs/:id (detail) ─────────────────────────────────────────────

  it('getDetail: ACTIVE job → JobDetail with public subset only (no PII/internal fields)', async () => {
    if (dockerUnavailable) return;

    const job = await createJob({ title: 'Detail Job' });
    const detail = await searchService.getDetail(job.id);

    expect(detail.id).toBe(job.id);
    expect(detail.title).toBe('Detail Job');
    expect(detail.description).toBeDefined();
    expect(detail.similar).toBeDefined();

    // Internal fields MUST be absent
    const keys = Object.keys(detail);
    expect(keys).not.toContain('postedByAdminId');
    expect(keys).not.toContain('autoArchiveAt');
    expect(keys).not.toContain('pausedAt');
    expect(keys).not.toContain('archivedAt');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('searchVector');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');

    // Company PII must be absent
    const companyKeys = Object.keys(detail.company);
    expect(companyKeys).not.toContain('phone');
    expect(companyKeys).not.toContain('contactPersons');
    expect(companyKeys).not.toContain('rejectionReason');
  });

  it('getDetail: non-ACTIVE job → NotFoundException (same as unknown id)', async () => {
    if (dockerUnavailable) return;

    const paused = await createJob({ title: 'Paused', status: JobStatus.PAUSED });

    await expect(searchService.getDetail(paused.id)).rejects.toThrow(NotFoundException);
    await expect(searchService.getDetail('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundException);
  });

  // ── 11. Similar jobs ────────────────────────────────────────────────────────

  it('similar jobs: returns ACTIVE jobs in same category or market, excludes the viewed job', async () => {
    if (dockerUnavailable) return;

    const main = await createJob({ title: 'Main Electrician', market: JobMarket.FOREIGN });
    const simCat = await createJob({ title: 'Similar by Category', market: JobMarket.LOCAL });
    const simMkt = await createJob({ title: 'Similar by Market', categoryId: CATEGORY_ID });
    await createJob({ title: 'Unrelated', status: JobStatus.ACTIVE, market: JobMarket.LOCAL,
      categoryId: await prismaClient.jobCategory.upsert({
        where: { id: 'other-cat-2' },
        create: { id: 'other-cat-2', slug: 'unrelated-cat', nameEn: 'Unrelated' },
        update: {},
      }).then((c) => c.id),
    });

    const detail = await searchService.getDetail(main.id);

    const similarIds = detail.similar.map((j) => j.id);
    expect(similarIds).not.toContain(main.id); // excludes self
    expect(similarIds).toContain(simCat.id);
    expect(similarIds).toContain(simMkt.id);
  });

  // ── 12. Cache invalidation correctness ─────────────────────────────────────

  it('cache invalidation: bumpSearchVersion causes next search to miss cache', async () => {
    if (dockerUnavailable) return;

    await createJob({ title: 'Cached Job' });

    // First search — cache miss → DB query → stored
    const first = await searchService.search({});
    expect(first.data).toHaveLength(1);

    // Bump version (simulating a job.published / job.paused / job.archived event)
    await cacheService.bumpSearchVersion();

    // Create a new job that should appear after invalidation
    await createJob({ title: 'New Job After Invalidation' });

    // Second search — cache misses (different version key) → DB query returns both
    const second = await searchService.search({});
    expect(second.data.length).toBeGreaterThanOrEqual(2);
    expect(second.data.some((j) => j.title === 'New Job After Invalidation')).toBe(true);
  });
});

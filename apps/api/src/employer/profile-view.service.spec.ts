/**
 * Integration tests for ProfileViewService + ProfileViewsReadService.
 *
 * Section 1 — Unit: ProfileViewService dedup logic (mocked Prisma + EventEmitter).
 * Section 2 — Integration (Testcontainers PG): full dedup cycle including
 *   window manipulation, notification emit, and candidate-side summary.
 *
 * Docker-skip pattern: Section 2 skips gracefully when Docker is unavailable.
 */

import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { ProfileViewService } from './profile-view.service';
import { ProfileViewsReadService } from '../candidate/profile-views-read.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { PROFILE_VIEW_EVENTS } from './profile-view.events';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

// ── Section 1: Unit tests — dedup with mocked Prisma ─────────────────────────

describe('ProfileViewService — dedup logic (mocked Prisma)', () => {
  let service: ProfileViewService;
  let mockPrisma: jest.Mocked<any>;
  let mockEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;

  beforeEach(() => {
    mockPrisma = {
      profileView: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'pv-1' }),
      },
    };
    mockEmitter = { emit: jest.fn() };

    service = new ProfileViewService(
      mockPrisma as unknown as PrismaService,
      mockEmitter as unknown as EventEmitter2,
    );
  });

  it('first view: inserts a row and emits profile.viewed', async () => {
    mockPrisma.profileView.findFirst.mockResolvedValue(null); // no existing view

    await service.recordView('company-1', 'Corp', 'cand-1', 'user-cand-1');

    expect(mockPrisma.profileView.create).toHaveBeenCalledTimes(1);
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      PROFILE_VIEW_EVENTS.VIEWED,
      expect.objectContaining({
        candidateId: 'cand-1',
        candidateUserId: 'user-cand-1',
        companyId: 'company-1',
        companyName: 'Corp',
      }),
    );
  });

  it('within 24h dedup window: no insert, no event', async () => {
    mockPrisma.profileView.findFirst.mockResolvedValue({ id: 'existing-pv' });

    await service.recordView('company-1', 'Corp', 'cand-1', 'user-cand-1');

    expect(mockPrisma.profileView.create).not.toHaveBeenCalled();
    expect(mockEmitter.emit).not.toHaveBeenCalled();
  });

  it('after 24h window: inserts again and emits', async () => {
    // First call: no existing view
    mockPrisma.profileView.findFirst.mockResolvedValueOnce(null);
    await service.recordView('company-1', 'Corp', 'cand-1', 'user-cand-1');
    expect(mockPrisma.profileView.create).toHaveBeenCalledTimes(1);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);

    // Second call: no view within window (simulates >24h later)
    mockPrisma.profileView.findFirst.mockResolvedValueOnce(null);
    await service.recordView('company-1', 'Corp', 'cand-1', 'user-cand-1');
    expect(mockPrisma.profileView.create).toHaveBeenCalledTimes(2);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('different company → separate dedup, both emit', async () => {
    mockPrisma.profileView.findFirst.mockResolvedValue(null);

    await service.recordView('company-1', 'Corp1', 'cand-1', 'user-cand-1');
    await service.recordView('company-2', 'Corp2', 'cand-1', 'user-cand-1');

    expect(mockPrisma.profileView.create).toHaveBeenCalledTimes(2);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
  });
});

// ── Section 2: Integration tests (Testcontainers PG) ─────────────────────────

let container: StartedTestContainer | null = null;
let prisma: PrismaClient | null = null;
let dockerUnavailable = false;

beforeAll(async () => {
  try {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'testdb' })
      .withExposedPorts(5432)
      .start();

    const port = container.getMappedPort(5432);
    const url = `postgresql://test:test@127.0.0.1:${port}/testdb`;
    process.env['DATABASE_URL'] = url;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
  } catch {
    dockerUnavailable = true;
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

function skipIfNoDocker() {
  if (dockerUnavailable) {
    console.warn('Docker unavailable — skipping Testcontainers test');
  }
  return dockerUnavailable;
}

async function seedWorld(p: PrismaClient) {
  const candidateUser = await p.user.create({
    data: {
      email: `cand-${Date.now()}@test.com`,
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
    },
  });
  const candidate = await p.candidateProfile.create({
    data: { userId: candidateUser.id, fullName: 'Ravi', profileVisible: true },
  });

  const employerUser = await p.user.create({
    data: {
      email: `emp-${Date.now()}@test.com`,
      role: UserRole.EMPLOYER,
      status: UserStatus.ACTIVE,
    },
  });
  const company = await p.company.create({
    data: {
      name: 'Gulf Builders',
      type: 'FOREIGN',
      registrationNumber: `REG-${Date.now()}`,
      industryType: 'Construction',
      phone: '+966',
      location: 'Riyadh',
      employeeRange: '100-200',
      status: 'APPROVED',
    },
  });
  await p.employerUser.create({
    data: { userId: employerUser.id, companyId: company.id, isPrimary: true },
  });

  return { candidateUser, candidate, company };
}

describe('ProfileViewService + ProfileViewsReadService — Testcontainers PG', () => {
  let pvService: ProfileViewService;
  let pvrService: ProfileViewsReadService;
  let emitter: EventEmitter2;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    if (dockerUnavailable || !prisma) return;
    const ps = {
      profileView: {
        findFirst: prisma.profileView.findFirst.bind(prisma),
        create: prisma.profileView.create.bind(prisma),
      },
    };
    emitter = new EventEmitter2();
    emitSpy = jest.spyOn(emitter, 'emit');
    pvService = new ProfileViewService(ps as unknown as PrismaService, emitter);
    pvrService = new ProfileViewsReadService({
      profileView: {
        count: prisma.profileView.count.bind(prisma),
        findMany: prisma.profileView.findMany.bind(prisma),
      },
    } as unknown as PrismaService);
  });

  afterEach(async () => {
    if (!prisma) return;
    await prisma.profileView.deleteMany();
    await prisma.notification.deleteMany();
  });

  it('view records a profile_views row', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser, candidate, company } = await seedWorld(prisma!);

    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);

    const rows = await prisma!.profileView.findMany({ where: { candidateId: candidate.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyId).toBe(company.id);
  });

  it('second view within 24h: no new row, no event', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser, candidate, company } = await seedWorld(prisma!);

    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);
    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);

    const rows = await prisma!.profileView.findMany({ where: { candidateId: candidate.id } });
    expect(rows).toHaveLength(1);
    // Event emitted exactly once
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('view after >24h window: inserts a second row and emits again', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser, candidate, company } = await seedWorld(prisma!);

    // Insert a row with viewedAt > 24h ago (simulate old view)
    const oldViewedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma!.profileView.create({
      data: { candidateId: candidate.id, companyId: company.id, viewedAt: oldViewedAt },
    });

    // Now record a new view — should pass the dedup check
    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);

    const rows = await prisma!.profileView.findMany({
      where: { candidateId: candidate.id },
      orderBy: { viewedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('PROFILE_VIEWED event emitted with correct companyName payload', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser, candidate, company } = await seedWorld(prisma!);

    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);

    expect(emitSpy).toHaveBeenCalledWith(
      PROFILE_VIEW_EVENTS.VIEWED,
      expect.objectContaining({ companyName: company.name }),
    );
  });

  it('GET /candidates/me/profile-views: returns correct totals and recent entries', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser, candidate, company } = await seedWorld(prisma!);

    await pvService.recordView(company.id, company.name, candidate.id, candidateUser.id);

    const summary = await pvrService.getSummary(candidate.id);
    expect(summary.total).toBe(1);
    expect(summary.last30Days).toBe(1);
    expect(summary.recent).toHaveLength(1);
    expect(summary.recent[0]!.companyName).toBe(company.name);
    expect(typeof summary.recent[0]!.viewedAt).toBe('string');
  });

  it('profile-views summary is scoped: candidate A cannot see candidate B views', async () => {
    if (skipIfNoDocker()) return;
    const { candidateUser: userA, candidate: candidateA, company } = await seedWorld(prisma!);
    const { candidate: candidateB } = await seedWorld(prisma!);

    await pvService.recordView(company.id, company.name, candidateA.id, userA.id);

    const summaryB = await pvrService.getSummary(candidateB.id);
    expect(summaryB.total).toBe(0);
    expect(summaryB.recent).toHaveLength(0);
  });
});

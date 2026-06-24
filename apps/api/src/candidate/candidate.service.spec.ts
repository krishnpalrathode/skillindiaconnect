// Integration block at the bottom needs Docker — extend timeout for all tests.
jest.setTimeout(180_000);

import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient, UserRole, UserStatus, DocumentType, ExperienceType } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { CandidateService } from './candidate.service';
import { CompletionService } from './completion/completion.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { CANDIDATE_EVENTS } from './events/candidate.events';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    userId: 'user-1',
    fullName: 'Test User',
    fatherName: null,
    dob: null,
    phone: null,
    phoneVerifiedAt: null,
    whatsappCapable: false,
    maritalStatus: null,
    religion: null,
    languages: [],
    jobCategoryId: null,
    photoKey: null,
    currentLocation: null,
    nationality: null,
    noticePeriod: null,
    salaryExpectationMin: null,
    salaryExpectationMax: null,
    salaryExpectationCurrency: null,
    isAvailable: true,
    profileVisible: true,
    showPhone: true,
    showReligion: false,
    waNotifications: true,
    emailNotifs: true,
    completionPct: 0,
    videoR2Key: null,
    videoDurationSec: null,
    videoSizeBytes: null,
    videoUploadedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    experiences: [],
    skills: [],
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('CandidateService', () => {
  let service: CandidateService;
  let prismaMock: {
    candidateProfile: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    jobCategory: { findUnique: jest.Mock };
    setting: { findUnique: jest.Mock };
  };
  let completionMock: jest.Mocked<
    Pick<CompletionService, 'recomputeForCandidate' | 'getMandatoryDocCount'>
  >;
  let eventEmitterMock: { emit: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      candidateProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      jobCategory: { findUnique: jest.fn() },
      setting: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    completionMock = {
      recomputeForCandidate: jest.fn().mockResolvedValue({ pct: 0, sections: [] }),
      getMandatoryDocCount: jest.fn().mockResolvedValue(3),
    };

    eventEmitterMock = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CompletionService, useValue: completionMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
      ],
    }).compile();

    service = module.get(CandidateService);
  });

  // ── assertCandidateRole ───────────────────────────────────────────────────

  it('assertCandidateRole: throws 403 for EMPLOYER', () => {
    expect(() => service.assertCandidateRole(UserRole.EMPLOYER)).toThrow(ForbiddenException);
  });

  it('assertCandidateRole: does not throw for CANDIDATE', () => {
    expect(() => service.assertCandidateRole(UserRole.CANDIDATE)).not.toThrow();
  });

  // ── getProfileByUserId — lazy creation ───────────────────────────────────

  it('returns existing profile via toSelf mapper', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(makeProfile());
    const result = await service.getProfileByUserId('user-1');
    expect(result.id).toBe('cand-1');
    expect(result.userId).toBe('user-1');
  });

  it('creates an empty profile on first access when none exists', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(null);
    prismaMock.candidateProfile.create.mockResolvedValue(makeProfile({ fullName: '' }));

    await service.getProfileByUserId('user-1');

    expect(prismaMock.candidateProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user-1', fullName: '' } }),
    );
  });

  // ── updateProfile ─────────────────────────────────────────────────────────

  it('updates personal-info fields and recomputes completion', async () => {
    const profile = makeProfile();
    prismaMock.candidateProfile.findUnique
      .mockResolvedValueOnce(profile) // first call (find or create)
      .mockResolvedValueOnce(makeProfile({ fullName: 'Jane', completionPct: 4 })); // after update

    await service.updateProfile('user-1', { fullName: 'Jane' });

    expect(prismaMock.candidateProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fullName: 'Jane' }) }),
    );
    expect(completionMock.recomputeForCandidate).toHaveBeenCalledWith('cand-1');
  });

  it('emits PROFILE_UPDATED event after update', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(makeProfile());
    await service.updateProfile('user-1', { fullName: 'Jane' });

    expect(eventEmitterMock.emit).toHaveBeenCalledWith(CANDIDATE_EVENTS.PROFILE_UPDATED, {
      candidateId: 'cand-1',
    });
  });

  it('throws 422 INVALID_JOB_CATEGORY for an unknown or inactive jobCategoryId', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(makeProfile());
    prismaMock.jobCategory.findUnique.mockResolvedValue(null);

    await expect(service.updateProfile('user-1', { jobCategoryId: 'bad-id' })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('throws 422 for an inactive job category', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(makeProfile());
    prismaMock.jobCategory.findUnique.mockResolvedValue({ isActive: false });

    await expect(service.updateProfile('user-1', { jobCategoryId: 'inactive-id' })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('does not throw when jobCategoryId is undefined (no category check)', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(makeProfile());
    await expect(service.updateProfile('user-1', { fullName: 'Test' })).resolves.not.toThrow();
    expect(prismaMock.jobCategory.findUnique).not.toHaveBeenCalled();
  });

  // ── handleDocumentChanged (event listener wired for S1-3) ─────────────────

  it('handleDocumentChanged triggers recomputeForCandidate', async () => {
    await service.handleDocumentChanged({ candidateId: 'cand-1' });
    expect(completionMock.recomputeForCandidate).toHaveBeenCalledWith('cand-1');
  });

  // ── findProfileOrThrow ────────────────────────────────────────────────────

  it('findProfileOrThrow throws 404 when profile does not exist', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(null);
    await expect(service.findProfileOrThrow('user-none')).rejects.toThrow(NotFoundException);
  });

  it('findProfileOrThrow returns { id } when profile exists', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue({ id: 'cand-1' });
    const result = await service.findProfileOrThrow('user-1');
    expect(result.id).toBe('cand-1');
  });

  // ── toSelf mapper includes phone/religion regardless of privacy toggles ──

  it('GET me returns phone and religion in self view regardless of show* flags', async () => {
    prismaMock.candidateProfile.findUnique.mockResolvedValue(
      makeProfile({
        phone: '+911234567890',
        religion: 'Hindu',
        showPhone: false,
        showReligion: false,
      }),
    );
    const result = await service.getProfileByUserId('user-1');
    expect(result.phone).toBe('+911234567890');
    expect(result.religion).toBe('Hindu');
  });
});

// ─── CandidateService integration (real DB) ───────────────────────────────────
// Tests the orchestration paths that mocked Prisma cannot prove: lazy creation,
// updateSettings persistence, getCompletion canApply logic, and the
// DOCUMENT_CHANGED event listener.

const CAND_API_DIR = path.resolve(__dirname, '../..');

let candPg: StartedTestContainer;
let candPrisma: PrismaClient;
let candModuleRef: TestingModule;
let candService: CandidateService;
let candEmitter: EventEmitter2;
let candDockerUnavailable = false;

describe('CandidateService — integration (real DB)', () => {
  beforeAll(async () => {
    try {
      candPg = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_test',
        })
        .withExposedPorts(5432)
        .start();

      const url = `postgresql://sic:sic@localhost:${candPg.getMappedPort(5432)}/sic_test`;

      execSync('pnpm exec prisma migrate deploy', {
        cwd: CAND_API_DIR,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      candPrisma = new PrismaClient({ datasources: { db: { url } } });
      await candPrisma.$connect();

      candModuleRef = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          CandidateService,
          CompletionService,
          { provide: PrismaService, useValue: candPrisma },
        ],
      }).compile();

      // init() triggers onApplicationBootstrap, which registers @OnEvent handlers.
      await candModuleRef.init();
      candService = candModuleRef.get(CandidateService);
      candEmitter = candModuleRef.get(EventEmitter2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('container runtime') ||
        msg.includes('Docker') ||
        msg.includes('ENOENT') ||
        msg.includes('connect ECONNREFUSED')
      ) {
        candDockerUnavailable = true;
        console.warn(
          '[integration] Docker unavailable — CandidateService integration skipped:',
          msg,
        );
      } else {
        throw err;
      }
    }
  });

  afterAll(async () => {
    await candModuleRef?.close();
    await candPrisma?.$disconnect();
    await candPg?.stop();
  });

  beforeEach(async () => {
    if (candDockerUnavailable) return;
    await candPrisma.user.deleteMany();
    await candPrisma.setting.deleteMany();
  });

  // ── Factories ─────────────────────────────────────────────────────────────

  async function candUser() {
    return candPrisma.user.create({
      data: {
        email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
        role: UserRole.CANDIDATE,
        status: UserStatus.ACTIVE,
      },
    });
  }

  async function candDoc(
    candidateId: string,
    type: DocumentType,
    opts: { expired?: boolean } = {},
  ) {
    const expiryDate = opts.expired
      ? new Date('2020-01-01') // past date
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year from now
    return candPrisma.candidateDocument.create({
      data: {
        candidateId,
        type,
        r2Key: `docs/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        expiryDate,
      },
    });
  }

  // ── Lazy creation ──────────────────────────────────────────────────────────

  it('getProfileByUserId: creates an empty profile row on first call (DB-verified)', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    const before = await candPrisma.candidateProfile.count({ where: { userId } });
    expect(before).toBe(0);

    await candService.getProfileByUserId(userId);

    const after = await candPrisma.candidateProfile.count({ where: { userId } });
    expect(after).toBe(1);
  });

  it('getProfileByUserId: second call does NOT create a duplicate row', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    await candService.getProfileByUserId(userId);
    await candService.getProfileByUserId(userId);

    const count = await candPrisma.candidateProfile.count({ where: { userId } });
    expect(count).toBe(1);
  });

  // ── updateProfile ─────────────────────────────────────────────────────────

  it('updateProfile: persists fullName and recomputes completionPct', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    await candService.updateProfile(userId, { fullName: 'Alice Kumar' });

    const row = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    expect(row!.fullName).toBe('Alice Kumar');
    expect(row!.completionPct).toBe(4); // fullName = 4%
  });

  it('updateProfile: religion and noticePeriod are saved but do NOT change completionPct', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    await candService.updateProfile(userId, { religion: 'Hindu', noticePeriod: '1 month' });

    const row = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    expect(row!.religion).toBe('Hindu');
    expect(row!.noticePeriod).toBe('1 month');
    // Neither religion nor noticePeriod scores — pct stays 0
    expect(row!.completionPct).toBe(0);
  });

  // ── updateSettings ────────────────────────────────────────────────────────

  it('updateSettings: persists showPhone and emailNotifs flags', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();
    await candService.getProfileByUserId(userId); // ensure profile exists

    await candService.updateSettings(userId, { showPhone: false, emailNotifs: false });

    const row = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    expect(row!.showPhone).toBe(false);
    expect(row!.emailNotifs).toBe(false);
  });

  it('updateSettings: persists salary expectation fields', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();
    await candService.getProfileByUserId(userId);

    await candService.updateSettings(userId, {
      salaryExpectationMin: 30_000,
      salaryExpectationMax: 60_000,
    });

    const row = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    expect(row!.salaryExpectationMin).toBe(30_000);
    expect(row!.salaryExpectationMax).toBe(60_000);
  });

  // ── getCompletion ─────────────────────────────────────────────────────────

  it('getCompletion: empty profile → canApply=false, missingForApply includes min_completion', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    // Seed min_completion_pct = 60 (explicit, matching the real seed)
    await candPrisma.setting.create({
      data: { key: 'candidates.min_completion_pct', value: 60, isCoreRule: false },
    });

    const result = await candService.getCompletion(userId);

    expect(result.canApply).toBe(false);
    expect(result.missingForApply).toContain('min_completion');
  });

  it('getCompletion: empty profile → missingForApply lists all 3 mandatory doc tokens', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    const result = await candService.getCompletion(userId);

    expect(result.missingForApply).toContain('document:PASSPORT');
    expect(result.missingForApply).toContain('document:EXPERIENCE_CERT');
    expect(result.missingForApply).toContain('document:EDUCATIONAL_CERT');
  });

  it('getCompletion: no passport → passport_expiry in missingForApply', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    const result = await candService.getCompletion(userId);

    expect(result.missingForApply).toContain('passport_expiry');
  });

  it('getCompletion: expired passport → passport_expiry in missingForApply', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();
    await candService.getProfileByUserId(userId);
    const profile = await candPrisma.candidateProfile.findUnique({ where: { userId } });

    await candDoc(profile!.id, DocumentType.PASSPORT, { expired: true });

    const result = await candService.getCompletion(userId);

    expect(result.missingForApply).toContain('passport_expiry');
  });

  it('getCompletion: valid passport (future expiry) with all 3 docs + sufficient pct → canApply=true', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();
    await candService.getProfileByUserId(userId);
    const profile = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    const candidateId = profile!.id;

    // Build full PI (40%) + 1 complete experience (20%) + 3 docs (30%) = 90%
    await candPrisma.candidateProfile.update({
      where: { id: candidateId },
      data: {
        fullName: 'Alice',
        fatherName: 'Bob',
        dob: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
        maritalStatus: 'SINGLE',
        languages: ['English'],
        jobCategoryId: null, // omit to keep simple
        currentLocation: 'Mumbai',
        nationality: 'Indian',
        photoKey: 'p.jpg',
      },
    });
    await candPrisma.workExperience.create({
      data: {
        candidateId,
        type: ExperienceType.INDIA,
        country: 'India',
        companyName: 'Acme',
        role: 'Eng',
        years: 2,
        months: 0,
      },
    });
    // All 3 mandatory docs, PASSPORT has future expiry
    await candDoc(candidateId, DocumentType.PASSPORT, { expired: false });
    await candDoc(candidateId, DocumentType.EXPERIENCE_CERT, { expired: false });
    await candDoc(candidateId, DocumentType.EDUCATIONAL_CERT, { expired: false });

    // Seed min_completion_pct = 60
    await candPrisma.setting.create({
      data: { key: 'candidates.min_completion_pct', value: 60, isCoreRule: false },
    });

    const result = await candService.getCompletion(userId);

    // 9 PI fields (no jobCategoryId) × 4% = 36 + 20 exp + 30 docs = 86%
    expect(result.pct).toBeGreaterThanOrEqual(60);
    expect(result.canApply).toBe(true);
    expect(result.missingForApply).toHaveLength(0);
  });

  it('getCompletion: returns pct, sections, canApply, missingForApply in response shape', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();

    const result = await candService.getCompletion(userId);

    expect(typeof result.pct).toBe('number');
    expect(Array.isArray(result.sections)).toBe(true);
    expect(typeof result.canApply).toBe('boolean');
    expect(Array.isArray(result.missingForApply)).toBe(true);
  });

  // ── DOCUMENT_CHANGED event listener ───────────────────────────────────────
  // The @OnEvent handler wired in S1-2 (S1-3 emits this). Proven here by
  // emitting via EventEmitter2.emitAsync() and asserting completionPct is updated.

  it('DOCUMENT_CHANGED: emitting the event recomputes and persists completionPct', async () => {
    if (candDockerUnavailable) return;
    const { id: userId } = await candUser();
    await candService.getProfileByUserId(userId);
    const profile = await candPrisma.candidateProfile.findUnique({ where: { userId } });
    const candidateId = profile!.id;

    // Before: 0 docs → completionPct = 0
    const before = await candPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(before!.completionPct).toBe(0);

    // Add a PASSPORT document directly to the DB (simulating what S1-3 would do).
    await candDoc(candidateId, DocumentType.PASSPORT, { expired: false });

    // Emit the event that S1-3 will emit after confirming a document upload.
    await candEmitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, { candidateId });

    // Handler should have called recomputeForCandidate and persisted the new pct.
    const after = await candPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    // 1/3 mandatory docs at N=3 → 10%
    expect(after!.completionPct).toBe(10);
  });
});

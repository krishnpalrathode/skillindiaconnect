/**
 * Integration tests for DocumentService + OnboardingService against a real
 * Postgres container. StorageService is stubbed at the boundary so tests don't
 * require a live R2 bucket. The BullMQ queue is also stubbed (jest.fn()) â€”
 * account.service.spec.ts tests the real queue with Redis.
 *
 * When Docker is unavailable the suite passes with all tests skipped.
 */
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { DocumentService } from './document.service';
import { OnboardingService } from './onboarding.service';
import { CandidateService } from './candidate.service';
import { CompletionService } from './completion/completion.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prisma: PrismaClient;
let documentService: DocumentService;
let onboardingService: OnboardingService;
let moduleRef: TestingModule;
let dockerUnavailable = false;

// Stub StorageService â€” no live bucket required.
const mockStorage = {
  presignPut: jest.fn(),
  headObject: jest.fn(),
  deleteObject: jest.fn(),
};

// Stub queue â€” no Redis required for document tests.
const mockR2Queue = { add: jest.fn() };

// â”€â”€â”€ Container lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_test',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_test`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    // Build module with real PG, stubbed storage/queue, and EventEmitter so
    // the DOCUMENT_CHANGED listener in CandidateService fires for real.
    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        DocumentService,
        OnboardingService,
        CandidateService,
        CompletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        {
          provide: 'BullQueue_r2-delete',
          useValue: mockR2Queue,
        },
      ],
    }).compile();

    await moduleRef.init();

    documentService = moduleRef.get(DocumentService);
    onboardingService = moduleRef.get(OnboardingService);
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
      console.warn('[integration] Docker unavailable â€” document tests skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await moduleRef?.close();
  await prisma?.$disconnect();
  await pg?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  jest.clearAllMocks();
  await prisma.user.deleteMany();
});

// â”€â”€â”€ Factories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function makeUser(role: UserRole = UserRole.CANDIDATE) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      role,
      status: UserStatus.ACTIVE,
    },
  });
}

async function makeCandidate(userId: string) {
  return prisma.candidateProfile.create({
    data: { userId, fullName: '' },
  });
}

// â”€â”€â”€ presign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DocumentService.presign', () => {
  it('accepted type + valid mime + valid size â†’ returns uploadUrl and scoped key', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.presignPut.mockResolvedValueOnce({
      url: 'https://r2.example.com/presigned-put',
      expiresInSeconds: 300,
    });

    const result = await documentService.presign(
      { type: 'PASSPORT', fileName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      candidateId,
    );

    expect(result.uploadUrl).toBe('https://r2.example.com/presigned-put');
    expect(result.key).toMatch(new RegExp(`^candidates/${candidateId}/PASSPORT/`));
    expect(result.expiresInSeconds).toBe(300);
  });

  it('WORKING_VIDEO â†’ 422 VIDEO_NOT_SUPPORTED_AT_MVP', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(
      documentService.presign(
        { type: 'WORKING_VIDEO', fileName: 'vid.mp4', mimeType: 'video/mp4', sizeBytes: 1024 },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('unknown type â†’ 422 INVALID_DOC_TYPE', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(
      documentService.presign(
        { type: 'UNKNOWN', fileName: 'file.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('invalid mimeType for type â†’ 422 INVALID_FILE_TYPE', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(
      documentService.presign(
        {
          type: 'PASSPORT',
          fileName: 'file.exe',
          mimeType: 'application/octet-stream',
          sizeBytes: 1024,
        },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('declared sizeBytes exceeds limit â†’ 422 FILE_TOO_LARGE', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(
      documentService.presign(
        {
          type: 'PASSPORT',
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 20 * 1024 * 1024, // 20 MB > 10 MB limit
        },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('key is scoped to the candidate prefix', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.presignPut.mockResolvedValueOnce({
      url: 'https://r2.example.com/url',
      expiresInSeconds: 300,
    });

    const result = await documentService.presign(
      {
        type: 'EXPERIENCE_CERT',
        fileName: 'cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
      },
      candidateId,
    );

    expect(result.key.startsWith(`candidates/${candidateId}/EXPERIENCE_CERT/`)).toBe(true);
  });
});

// â”€â”€â”€ confirm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DocumentService.confirm', () => {
  it('HEAD missing â†’ 422 UPLOAD_NOT_FOUND', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce(null);

    await expect(
      documentService.confirm(
        { key: `candidates/${candidateId}/PASSPORT/uuid-file.pdf` },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('HEAD real size exceeds limit â†’ 422 FILE_TOO_LARGE (declared size can be falsified)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    // Client declared 1 KB but actual upload is 20 MB.
    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 20 * 1024 * 1024,
      contentType: 'application/pdf',
    });

    await expect(
      documentService.confirm(
        { key: `candidates/${candidateId}/PASSPORT/uuid-file.pdf` },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('key not under caller prefix â†’ 403 KEY_NOT_OWNED', async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    // A tries to confirm a key belonging to B.
    await expect(
      documentService.confirm(
        { key: `candidates/${candidateBId}/PASSPORT/uuid-file.pdf` },
        candidateAId,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('success â†’ persists doc with HEAD-derived size/mime (not declared values)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 200_000,
      contentType: 'application/pdf',
    });

    const key = `candidates/${candidateId}/EXPERIENCE_CERT/uuid-cert.pdf`;
    const doc = await documentService.confirm({ key }, candidateId);

    expect(doc.type).toBe('EXPERIENCE_CERT');
    expect(doc.sizeBytes).toBe(200_000);
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.r2Key).toBe(key);

    const row = await prisma.candidateDocument.findUnique({
      where: { candidateId_type: { candidateId, type: 'EXPERIENCE_CERT' } },
    });
    expect(row).not.toBeNull();
    expect(row!.sizeBytes).toBe(200_000);
  });

  it('re-confirm (upsert): no duplicate row â€” count stays at 1', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValue({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });

    const key = `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf`;
    await documentService.confirm({ key }, candidateId);
    await documentService.confirm({ key }, candidateId);

    const count = await prisma.candidateDocument.count({ where: { candidateId } });
    expect(count).toBe(1);
  });

  it('passport confirm sets expiryDate from request body', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 500_000,
      contentType: 'image/jpeg',
    });

    const expiryDate = '2030-12-31';
    const key = `candidates/${candidateId}/PASSPORT/uuid-passport.jpg`;
    const doc = await documentService.confirm({ key, expiryDate }, candidateId);

    expect(doc.expiryDate).not.toBeNull();
    expect(doc.expiryDate!.toISOString().startsWith('2030-12-31')).toBe(true);
  });

  it('passport confirm without expiryDate â†’ 422 INVALID_PASSPORT_EXPIRY', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 500_000,
      contentType: 'image/jpeg',
    });

    await expect(
      documentService.confirm(
        { key: `candidates/${candidateId}/PASSPORT/uuid-passport.jpg` },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('passport with past expiryDate â†’ 422 INVALID_PASSPORT_EXPIRY', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 500_000,
      contentType: 'image/jpeg',
    });

    await expect(
      documentService.confirm(
        {
          key: `candidates/${candidateId}/PASSPORT/uuid-passport.jpg`,
          expiryDate: '2020-01-01',
        },
        candidateId,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('emits candidate.document.changed â†’ completion listener recomputes pct', async () => {
    if (dockerUnavailable) return;
    const emitter = moduleRef.get(EventEmitter2);
    const spy = jest.spyOn(emitter, 'emitAsync');

    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });

    await documentService.confirm(
      { key: `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf` },
      candidateId,
    );

    expect(spy).toHaveBeenCalledWith('candidate.document.changed', { candidateId });
  });

  // â”€â”€ Live recompute chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('live recompute chain: confirming a mandatory doc increases completionPct', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const before = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(before!.completionPct).toBe(0);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });

    await documentService.confirm(
      { key: `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf` },
      candidateId,
    );

    const after = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    // 1 of 3 mandatory docs â†’ 30/3 = 10%
    expect(after!.completionPct).toBe(10);
  });
});

// â”€â”€â”€ delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DocumentService.deleteDocument', () => {
  it('removes the document row from the DB', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });
    await documentService.confirm(
      { key: `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf` },
      candidateId,
    );

    await documentService.deleteDocument('EDUCATIONAL_CERT', candidateId);

    const row = await prisma.candidateDocument.findUnique({
      where: { candidateId_type: { candidateId, type: 'EDUCATIONAL_CERT' } },
    });
    expect(row).toBeNull();
  });

  it('emits candidate.document.changed and recompute drops pct back to 0', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });
    await documentService.confirm(
      { key: `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf` },
      candidateId,
    );
    const mid = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(mid!.completionPct).toBeGreaterThan(0);

    await documentService.deleteDocument('EDUCATIONAL_CERT', candidateId);

    const final = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(final!.completionPct).toBe(0);
  });

  it('absent document â†’ 404', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(documentService.deleteDocument('PASSPORT', candidateId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('enqueues R2 object-delete job with the stored r2Key', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const key = `candidates/${candidateId}/EXPERIENCE_CERT/uuid-exp.pdf`;
    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 50_000,
      contentType: 'application/pdf',
    });
    await documentService.confirm({ key }, candidateId);

    mockR2Queue.add.mockClear();
    await documentService.deleteDocument('EXPERIENCE_CERT', candidateId);

    expect(mockR2Queue.add).toHaveBeenCalledWith(
      'delete-object',
      { key },
      expect.objectContaining({ jobId: `r2del-${key}` }),
    );
  });
});

// â”€â”€â”€ complete-onboarding (soft-block) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('OnboardingService.complete (soft-block)', () => {
  it('candidate with NO docs and 0% completion â†’ returns 200 with completionPct=0', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const result = await onboardingService.complete(candidateId);
    expect(result.completionPct).toBe(0);
  });

  it('candidate below apply threshold â†’ does NOT throw (soft-block confirmed)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    // Completeness is 0%; if it were a gate this would throw.
    await expect(onboardingService.complete(candidateId)).resolves.not.toThrow();
  });

  it('returns current completionPct after docs are present', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    mockStorage.headObject.mockResolvedValueOnce({
      sizeBytes: 100_000,
      contentType: 'application/pdf',
    });
    await documentService.confirm(
      { key: `candidates/${candidateId}/EDUCATIONAL_CERT/uuid-cert.pdf` },
      candidateId,
    );

    const result = await onboardingService.complete(candidateId);
    expect(result.completionPct).toBe(10); // 1/3 docs = 10%
  });
});


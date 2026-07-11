/**
 * The Pro document gate (S5-B3) on real Postgres:
 *
 *  - Plan check FIRST: a Free employer gets 403 PLAN_UPGRADE_REQUIRED with
 *    ZERO candidate-existence leakage (probing an invisible or nonexistent
 *    candidate returns the byte-identical plan 403; storage never touched).
 *  - S3-B2 privacy inheritance: nonexistent / invisible / PENDING_DELETION /
 *    type-not-uploaded are ONE indistinguishable 404.
 *  - 300s signed GET grants; EVERY issuance writes a document.viewed audit
 *    whose RAW meta carries the document TYPE and never the key or URL.
 *  - GRACE retains access; EXPIRED loses it.
 *
 * Storage is stubbed at the presign boundary (no network); audit rows are
 * written by the REAL AuditService and asserted raw from audit_logs.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CompanyStatus,
  CompanyType,
  DocumentType,
  PlanPeriod,
  PrismaClient,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { EmployerService } from './employer.service';
import { DocumentAccessService } from './document-access.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');
const PASSPORT_KEY = 'candidates/dg-cand-1/passport/9f2c1e.pdf';

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: DocumentAccessService;
let presignGet: jest.Mock;
let dockerUnavailable = false;

let freeUserId: string;
let proUserId: string;
let proCompanyId: string;
let pendingUserId: string;
let visibleCandId: string;
let invisibleCandId: string;
let deletionCandId: string;
let noDocCandId: string;
const NONEXISTENT_ID = '00000000-0000-4000-8000-000000000000';

let seq = 0;

const settingsStub = {
  get: async () => 1, // only FREE_MAX_ACTIVE_JOBS is read on this path
} as unknown as SettingsService;

async function mkEmployer(status: CompanyStatus): Promise<{ userId: string; companyId: string }> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: { email: `dg-emp-${n}@example.com`, role: UserRole.EMPLOYER },
  });
  const company = await prisma.company.create({
    data: {
      name: `DocGate Co ${n}`,
      type: CompanyType.LOCAL,
      status,
      registrationNumber: `DG-${n}`,
      industryType: 'Construction',
      phone: `+9144400${n}`,
      location: 'Delhi',
      employeeRange: '10-50',
    },
  });
  await prisma.employerUser.create({
    data: { userId: user.id, companyId: company.id, isPrimary: true },
  });
  return { userId: user.id, companyId: company.id };
}

async function mkCandidate(o: {
  visible: boolean;
  userStatus?: UserStatus;
  withPassport?: boolean;
  r2Key?: string;
}): Promise<string> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: {
      email: `dg-cand-${n}@example.com`,
      role: UserRole.CANDIDATE,
      status: o.userStatus ?? UserStatus.ACTIVE,
    },
  });
  const profile = await prisma.candidateProfile.create({
    data: { userId: user.id, fullName: `DG Candidate ${n}`, profileVisible: o.visible },
  });
  if (o.withPassport !== false) {
    await prisma.candidateDocument.create({
      data: {
        candidateId: profile.id,
        type: DocumentType.PASSPORT,
        r2Key: o.r2Key ?? `candidates/dg-cand-${n}/passport/key.pdf`,
        fileName: 'passport.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
  }
  return profile.id;
}

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_doc_gate' })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_doc_gate`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const proPlanId = (
      await prisma.plan.create({
        data: { code: 'PRO_MONTHLY', name: 'Pro Monthly', priceSubunits: 299_900, period: PlanPeriod.MONTHLY, maxActiveJobs: null, features: [] },
      })
    ).id;

    ({ userId: freeUserId } = await mkEmployer(CompanyStatus.APPROVED));
    ({ userId: proUserId, companyId: proCompanyId } = await mkEmployer(CompanyStatus.APPROVED));
    ({ userId: pendingUserId } = await mkEmployer(CompanyStatus.PENDING));

    await prisma.subscription.create({
      data: {
        companyId: proCompanyId,
        planId: proPlanId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    visibleCandId = await mkCandidate({ visible: true, r2Key: PASSPORT_KEY });
    invisibleCandId = await mkCandidate({ visible: false });
    deletionCandId = await mkCandidate({ visible: true, userStatus: UserStatus.PENDING_DELETION });
    noDocCandId = await mkCandidate({ visible: true, withPassport: false });

    presignGet = jest
      .fn()
      .mockImplementation(async (key: string, exp: number) => `https://stub.r2/signed?exp=${exp}`);

    const prismaSvc = prisma as unknown as PrismaService;
    service = new DocumentAccessService(
      new EmployerService(prismaSvc, null as never),
      new SubscriptionReadService(prismaSvc, settingsStub),
      new CandidateReadService(prismaSvc),
      { presignGet } as unknown as StorageService,
      new AuditService(prismaSvc),
    );
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping document-gate tests.');
  }
});

afterAll(async () => {
  if (dockerUnavailable) return;
  await prisma.$disconnect();
  await pg.stop();
});

const gatedIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

async function capture(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (e) {
    const err = e as ForbiddenException | NotFoundException;
    return { status: err.getStatus(), body: err.getResponse() };
  }
  throw new Error('expected the call to throw');
}

// ── Plan gate (the anti-leak ordering) ────────────────────────────────────────

describe('plan gate — checked BEFORE candidate resolution', () => {
  gatedIt('Free employer + visible candidate → 403 PLAN_UPGRADE_REQUIRED', async () => {
    const { status, body } = await capture(
      service.issueDocumentUrl(freeUserId, visibleCandId, DocumentType.PASSPORT),
    );
    expect(status).toBe(403);
    expect((body as { code: string }).code).toBe('PLAN_UPGRADE_REQUIRED');
  });

  gatedIt('zero existence leakage: invisible and NONEXISTENT candidates give the byte-identical plan 403; storage untouched', async () => {
    presignGet.mockClear();
    const visible = await capture(
      service.issueDocumentUrl(freeUserId, visibleCandId, DocumentType.PASSPORT),
    );
    const invisible = await capture(
      service.issueDocumentUrl(freeUserId, invisibleCandId, DocumentType.PASSPORT),
    );
    const nonexistent = await capture(
      service.issueDocumentUrl(freeUserId, NONEXISTENT_ID, DocumentType.PASSPORT),
    );
    expect(invisible).toEqual(visible);
    expect(nonexistent).toEqual(visible);
    expect(presignGet).not.toHaveBeenCalled();
  });

  gatedIt('not-approved employer → 403 EMPLOYER_NOT_APPROVED (check 1 precedes the plan gate)', async () => {
    const { status, body } = await capture(
      service.issueDocumentUrl(pendingUserId, visibleCandId, DocumentType.PASSPORT),
    );
    expect(status).toBe(403);
    expect((body as { code: string }).code).toBe('EMPLOYER_NOT_APPROVED');
  });
});

// ── The grant + the audit trail ───────────────────────────────────────────────

describe('Pro grant + per-issuance audit', () => {
  gatedIt('Pro + visible + uploaded → 300s signed URL; presignGet called with (r2Key, 300)', async () => {
    presignGet.mockClear();
    const grant = await service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.PASSPORT);
    expect(grant).toEqual({ url: 'https://stub.r2/signed?exp=300', expiresInSeconds: 300 });
    expect(presignGet).toHaveBeenCalledWith(PASSPORT_KEY, 300);
  });

  gatedIt('EVERY issuance writes document.viewed — raw meta has the TYPE, never the key or URL', async () => {
    await prisma.auditLog.deleteMany({ where: { action: AUDIT_ACTIONS.DOCUMENT_VIEWED } });

    await service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.PASSPORT);
    await service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.PASSPORT);

    const rows = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.DOCUMENT_VIEWED },
    });
    expect(rows).toHaveLength(2); // per-issuance, not per-document

    for (const row of rows) {
      expect(row.actorUserId).toBe(proUserId);
      expect(row.targetId).toBe(visibleCandId);
      const meta = row.meta as Record<string, unknown>;
      expect(meta.documentType).toBe('PASSPORT');
      expect(meta.companyId).toBe(proCompanyId);
      expect(meta.candidateId).toBe(visibleCandId);
      // The DPDP trail must never carry the object key or a signed URL —
      // asserted on the RAW persisted JSON, not the mapper output.
      const raw = JSON.stringify(meta);
      expect(raw).not.toContain(PASSPORT_KEY);
      expect(raw).not.toContain('stub.r2');
      expect(Object.keys(meta)).toEqual(
        expect.not.arrayContaining(['r2Key', 'url', 'signedUrl', 'documentUrl']),
      );
    }
  });
});

// ── The one indistinguishable 404 ─────────────────────────────────────────────

describe('privacy inheritance — one 404 for all causes', () => {
  gatedIt('nonexistent / invisible / PENDING_DELETION / type-not-uploaded → byte-identical 404s', async () => {
    const results = await Promise.all([
      capture(service.issueDocumentUrl(proUserId, NONEXISTENT_ID, DocumentType.PASSPORT)),
      capture(service.issueDocumentUrl(proUserId, invisibleCandId, DocumentType.PASSPORT)),
      capture(service.issueDocumentUrl(proUserId, deletionCandId, DocumentType.PASSPORT)),
      capture(service.issueDocumentUrl(proUserId, noDocCandId, DocumentType.PASSPORT)),
      // Visible candidate, but a type they never uploaded — same 404 class.
      capture(service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.WORKING_VIDEO)),
    ]);
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r).toEqual(results[0]);
    }
  });
});

// ── GRACE / EXPIRED semantics ─────────────────────────────────────────────────

describe('GRACE keeps access, EXPIRED loses it', () => {
  gatedIt('GRACE → the grant still succeeds (grace is fully paid)', async () => {
    await prisma.subscription.updateMany({
      where: { companyId: proCompanyId },
      data: {
        status: SubscriptionStatus.GRACE,
        graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const grant = await service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.PASSPORT);
    expect(grant.expiresInSeconds).toBe(300);
  });

  gatedIt('EXPIRED → 403 PLAN_UPGRADE_REQUIRED (back on Free)', async () => {
    await prisma.subscription.updateMany({
      where: { companyId: proCompanyId },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    const { status, body } = await capture(
      service.issueDocumentUrl(proUserId, visibleCandId, DocumentType.PASSPORT),
    );
    expect(status).toBe(403);
    expect((body as { code: string }).code).toBe('PLAN_UPGRADE_REQUIRED');
  });
});

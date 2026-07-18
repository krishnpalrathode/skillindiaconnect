/**
 * Admin document grants (S6a-B1, decision 5) on real Postgres.
 *
 * The load-bearing assertions:
 *   - THE RELAXATION: an admin CAN grant on a profileVisible=false candidate
 *     (which the employer gate refuses) — and the audit row exists for it. Those
 *     two facts together are the control; either alone is a bug.
 *   - Every issuance writes `document.viewed` whose RAW persisted meta carries
 *     the document TYPE and NEVER the r2Key or the signed URL.
 *
 * Storage is stubbed at the presign boundary (no network); AuditService is REAL
 * so the meta assertions run against what actually lands in Postgres.
 */
import { NotFoundException } from '@nestjs/common';
import {
  CompanyStatus,
  CompanyType,
  DocumentType,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { AdminDocumentsService } from './admin-documents.service';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');
const VISIBLE_KEY = 'candidates/visible/passport.pdf';
const HIDDEN_KEY = 'candidates/hidden/passport.pdf';
const CERT_KEY = 'companies/acme/cert/reg.pdf';

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: AdminDocumentsService;
let presignGet: jest.Mock;
let dockerUnavailable = false;

let visibleCandidateId: string;
let hiddenCandidateId: string;
let deletingCandidateId: string;
let companyId: string;

const ADMIN = { userId: '33333333-3333-4333-8333-333333333333', role: UserRole.ADMIN };

let seq = 0;

async function mkCandidate(o: {
  visible: boolean;
  userStatus?: UserStatus;
  r2Key?: string;
}): Promise<string> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: {
      email: `dg-${n}@example.com`,
      role: UserRole.CANDIDATE,
      status: o.userStatus ?? UserStatus.ACTIVE,
    },
  });
  const profile = await prisma.candidateProfile.create({
    data: { userId: user.id, fullName: `Cand ${n}`, profileVisible: o.visible },
  });
  if (o.r2Key) {
    await prisma.candidateDocument.create({
      data: {
        candidateId: profile.id,
        type: DocumentType.PASSPORT,
        r2Key: o.r2Key,
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
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_admin_docs',
      })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_admin_docs`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    visibleCandidateId = await mkCandidate({ visible: true, r2Key: VISIBLE_KEY });
    // THE fixture that matters: hidden from every employer, still reachable by an admin.
    hiddenCandidateId = await mkCandidate({ visible: false, r2Key: HIDDEN_KEY });
    deletingCandidateId = await mkCandidate({
      visible: true,
      userStatus: UserStatus.PENDING_DELETION,
      r2Key: 'candidates/deleting/passport.pdf',
    });

    const company = await prisma.company.create({
      data: {
        name: 'Acme Recruit',
        type: CompanyType.LOCAL,
        status: CompanyStatus.PENDING,
        registrationNumber: 'ACME-1',
        industryType: 'Construction',
        phone: '+91100',
        location: 'Pune',
        employeeRange: '10-50',
      },
    });
    companyId = company.id;
    await prisma.companyDocument.create({
      data: {
        companyId,
        r2Key: CERT_KEY,
        fileName: 'reg.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    });

    presignGet = jest.fn().mockImplementation(async (_key: string, exp: number) =>
      `https://stub.r2/signed?exp=${exp}`,
    );

    const prismaSvc = prisma as unknown as PrismaService;
    service = new AdminDocumentsService(
      new EmployerService(prismaSvc, null as never),
      new CandidateReadService(prismaSvc),
      { presignGet } as unknown as StorageService,
      new AuditService(prismaSvc),
    );
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping admin-documents tests.');
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

const viewedRows = () =>
  prisma.auditLog.findMany({
    where: { action: AUDIT_ACTIONS.DOCUMENT_VIEWED },
    orderBy: { id: 'desc' },
  });

// ── The relaxation, and the audit that justifies it ──────────────────────────

describe('candidate documents — the deliberate visibility relaxation', () => {
  gatedIt('a VISIBLE candidate grants a 300s signed URL', async () => {
    const grant = await service.issueCandidateDocumentUrl(
      visibleCandidateId,
      DocumentType.PASSPORT,
      ADMIN,
    );
    expect(grant).toEqual({ url: 'https://stub.r2/signed?exp=300', expiresInSeconds: 300 });
    expect(presignGet).toHaveBeenCalledWith(VISIBLE_KEY, 300);
  });

  gatedIt(
    'THE RELAXATION: a profileVisible=FALSE candidate is STILL reachable by an admin (the employer gate refuses this) — and the grant is audited',
    async () => {
      await prisma.auditLog.deleteMany();

      const grant = await service.issueCandidateDocumentUrl(
        hiddenCandidateId,
        DocumentType.PASSPORT,
        ADMIN,
      );
      expect(grant.expiresInSeconds).toBe(300);
      expect(presignGet).toHaveBeenCalledWith(HIDDEN_KEY, 300);

      // The accountability half — without this row the relaxation is a backdoor.
      const rows = await viewedRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorUserId).toBe(ADMIN.userId);
      expect(rows[0]!.actorRole).toBe(UserRole.ADMIN);
      expect(rows[0]!.targetId).toBe(hiddenCandidateId);
    },
  );

  gatedIt('a PENDING_DELETION candidate is still reachable (a dispute may concern them)', async () => {
    const grant = await service.issueCandidateDocumentUrl(
      deletingCandidateId,
      DocumentType.PASSPORT,
      ADMIN,
    );
    expect(grant.expiresInSeconds).toBe(300);
  });

  gatedIt('unknown candidate / never-uploaded type → 404 (indistinguishable)', async () => {
    await expect(
      service.issueCandidateDocumentUrl(
        '00000000-0000-4000-8000-000000000000',
        DocumentType.PASSPORT,
        ADMIN,
      ),
    ).rejects.toThrow(NotFoundException);

    // Visible candidate, a type they never uploaded — the same 404.
    await expect(
      service.issueCandidateDocumentUrl(
        visibleCandidateId,
        DocumentType.WORKING_VIDEO,
        ADMIN,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

// ── The audit meta discipline ────────────────────────────────────────────────

describe('every issuance is audited with TYPE-not-key meta', () => {
  gatedIt('candidate grant: raw persisted meta has the TYPE, never the r2Key or the URL', async () => {
    await prisma.auditLog.deleteMany();

    await service.issueCandidateDocumentUrl(visibleCandidateId, DocumentType.PASSPORT, ADMIN);

    const rows = await viewedRows();
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta['documentType']).toBe('PASSPORT');
    expect(meta['candidateId']).toBe(visibleCandidateId);

    // Asserted on the RAW persisted JSON — the DPDP trail must never carry the
    // object key or a signed URL.
    const raw = JSON.stringify(meta);
    expect(raw).not.toContain(VISIBLE_KEY);
    expect(raw).not.toContain('stub.r2');
    expect(Object.keys(meta)).toEqual(
      expect.not.arrayContaining(['r2Key', 'url', 'signedUrl', 'documentUrl']),
    );
  });

  gatedIt('EVERY issuance writes a row — two grants, two rows (not one per document)', async () => {
    await prisma.auditLog.deleteMany();
    await service.issueCandidateDocumentUrl(visibleCandidateId, DocumentType.PASSPORT, ADMIN);
    await service.issueCandidateDocumentUrl(visibleCandidateId, DocumentType.PASSPORT, ADMIN);
    expect(await viewedRows()).toHaveLength(2);
  });
});

// ── Employer certificate ─────────────────────────────────────────────────────

describe('employer registration certificate', () => {
  gatedIt('grants a 300s signed URL and audits the issuance', async () => {
    await prisma.auditLog.deleteMany();

    const grant = await service.issueEmployerCertificateUrl(companyId, ADMIN);
    expect(grant.expiresInSeconds).toBe(300);
    expect(presignGet).toHaveBeenCalledWith(CERT_KEY, 300);

    const rows = await viewedRows();
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta['documentType']).toBe('REGISTRATION_CERT');
    expect(meta['companyId']).toBe(companyId);
    expect(JSON.stringify(meta)).not.toContain(CERT_KEY);
  });

  gatedIt('no certificate on file / unknown company → 404', async () => {
    const bare = await prisma.company.create({
      data: {
        name: 'No Cert Co',
        type: CompanyType.LOCAL,
        status: CompanyStatus.PENDING,
        registrationNumber: 'NC-1',
        industryType: 'IT',
        phone: '+91200',
        location: 'Delhi',
        employeeRange: '1-10',
      },
    });
    await expect(service.issueEmployerCertificateUrl(bare.id, ADMIN)).rejects.toThrow(
      NotFoundException,
    );
  });
});

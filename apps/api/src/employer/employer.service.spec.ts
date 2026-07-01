/**
 * Integration tests for EmployerService against a real Postgres container.
 *
 * Covers: register (creates PENDING company + employer_users link), duplicate
 * registration â†’ 409 COMPANY_EXISTS, cert presign/confirm (StorageService stubbed),
 * assertApproved (throws for non-APPROVED statuses), getCompanyType.
 * Docker-skip pattern: skips gracefully when Docker/infra is unavailable.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CompanyStatus, CompanyType, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { EmployerService } from './employer.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prisma: PrismaClient;
let employerService: EmployerService;
let dockerUnavailable = false;

const mockStorage: jest.Mocked<Pick<StorageService, 'presignPut' | 'headObject'>> = {
  presignPut: jest.fn().mockResolvedValue({ url: 'https://r2.example/put', expiresInSeconds: 300 }),
  headObject: jest.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'application/pdf' }),
};

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

    employerService = new EmployerService(
      prisma as unknown as PrismaService,
      mockStorage as unknown as StorageService,
    );
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
      console.warn('[integration] Docker unavailable â€” employer service tests skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  // Delete companies first (employer_users cascade from companies AND users).
  // No jobs exist in these tests so the Restrict constraint is safe.
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  jest.clearAllMocks();
  mockStorage.presignPut.mockResolvedValue({ url: 'https://r2.example/put', expiresInSeconds: 300 });
  mockStorage.headObject.mockResolvedValue({ sizeBytes: 1024, contentType: 'application/pdf' });
});

// â”€â”€â”€ Factories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function makeEmployerUser() {
  return prisma.user.create({
    data: {
      email: `emp-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      role: UserRole.EMPLOYER,
      status: UserStatus.ACTIVE,
    },
  });
}

const BASE_DTO = {
  name: 'Acme Recruit',
  type: CompanyType.LOCAL,
  registrationNumber: 'REG123',
  industryType: 'Construction',
  phone: '+919876543210',
  location: 'Mumbai, India',
  employeeRange: '50-200',
  languagePref: ['en', 'hi'],
  description: 'A test employer.',
};

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('EmployerService â€” integration (real DB)', () => {
  // â”€â”€ register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('register: creates a PENDING company + employer_users link', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();

    const company = await employerService.register(user.id, BASE_DTO);

    expect(company.id).toBeTruthy();
    expect(company.status).toBe(CompanyStatus.PENDING);
    expect(company.name).toBe('Acme Recruit');
    expect(company.type).toBe(CompanyType.LOCAL);

    const link = await prisma.employerUser.findUnique({ where: { userId: user.id } });
    expect(link).not.toBeNull();
    expect(link!.companyId).toBe(company.id);
    expect(link!.isPrimary).toBe(true);
  });

  it('register: second register for the same employer user â†’ 409 COMPANY_EXISTS', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await employerService.register(user.id, BASE_DTO);

    await expect(
      employerService.register(user.id, { ...BASE_DTO, registrationNumber: 'REG456' }),
    ).rejects.toThrow(ConflictException);
  });

  it('register: does NOT create a second company row on duplicate', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await employerService.register(user.id, BASE_DTO);
    try {
      await employerService.register(user.id, BASE_DTO);
    } catch {
      // expected
    }
    const count = await prisma.company.count({ where: { name: 'Acme Recruit' } });
    expect(count).toBe(1);
  });

  // â”€â”€ getCompanyForEmployerUser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('getCompanyForEmployerUser: returns the company for a linked employer user', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const created = await employerService.register(user.id, BASE_DTO);

    const found = await employerService.getCompanyForEmployerUser(user.id);
    expect(found.id).toBe(created.id);
  });

  it('getCompanyForEmployerUser: unlinked user â†’ 404 COMPANY_NOT_FOUND', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await expect(employerService.getCompanyForEmployerUser(user.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  // â”€â”€ cert presign / confirm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('presignCert: returns uploadUrl + key scoped to company', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);

    const result = await employerService.presignCert(user.id, {
      fileName: 'cert.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(result.uploadUrl).toBeTruthy();
    expect(result.key).toMatch(new RegExp(`^companies/${company.id}/cert/`));
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it('confirmCert: HEAD-validates and creates a company_documents row', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);

    const key = `companies/${company.id}/cert/abc-cert.pdf`;
    const doc = await employerService.confirmCert(user.id, { key });

    expect(doc.r2Key).toBe(key);
    const row = await prisma.companyDocument.findFirst({ where: { companyId: company.id } });
    expect(row).not.toBeNull();
  });

  it('confirmCert: key belonging to a different company â†’ 403 KEY_NOT_OWNED', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await employerService.register(user.id, BASE_DTO);

    await expect(
      employerService.confirmCert(user.id, { key: 'companies/other-id/cert/fake.pdf' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('confirmCert: object not found in R2 â†’ 422 UPLOAD_NOT_FOUND', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    mockStorage.headObject.mockResolvedValueOnce(null);

    await expect(
      employerService.confirmCert(user.id, { key: `companies/${company.id}/cert/missing.pdf` }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // â”€â”€ assertApproved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('assertApproved: PENDING â†’ throws 403 EMPLOYER_NOT_APPROVED', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    await expect(employerService.assertApproved(company.id)).rejects.toThrow(ForbiddenException);
  });

  it('assertApproved: APPROVED â†’ resolves without throwing', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    await prisma.company.update({
      where: { id: company.id },
      data: { status: CompanyStatus.APPROVED, approvedAt: new Date() },
    });
    await expect(employerService.assertApproved(company.id)).resolves.toBeUndefined();
  });

  it('assertApproved: REJECTED â†’ throws 403', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    await prisma.company.update({
      where: { id: company.id },
      data: { status: CompanyStatus.REJECTED, rejectionReason: 'Invalid docs' },
    });
    await expect(employerService.assertApproved(company.id)).rejects.toThrow(ForbiddenException);
  });

  it('assertApproved: SUSPENDED â†’ throws 403', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    await prisma.company.update({
      where: { id: company.id },
      data: { status: CompanyStatus.SUSPENDED, suspendedAt: new Date() },
    });
    await expect(employerService.assertApproved(company.id)).rejects.toThrow(ForbiddenException);
  });

  // â”€â”€ getCompanyType â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('getCompanyType: returns LOCAL for a LOCAL company', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    const type = await employerService.getCompanyType(company.id);
    expect(type).toBe(CompanyType.LOCAL);
  });

  it('getCompanyType: returns FOREIGN for a FOREIGN company', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, {
      ...BASE_DTO,
      type: CompanyType.FOREIGN,
    });
    const type = await employerService.getCompanyType(company.id);
    expect(type).toBe(CompanyType.FOREIGN);
  });

  // â”€â”€ updateCompany / resubmit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('updateCompany: modifies editable fields and persists them', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await employerService.register(user.id, BASE_DTO);

    const updated = await employerService.updateCompany(user.id, { phone: '+919999999999' });
    expect(updated.phone).toBe('+919999999999');
  });

  it('updateCompany on REJECTED company: transitions back to PENDING and clears reason', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    const company = await employerService.register(user.id, BASE_DTO);
    await prisma.company.update({
      where: { id: company.id },
      data: { status: CompanyStatus.REJECTED, rejectionReason: 'Bad docs' },
    });

    const resubmitted = await employerService.updateCompany(user.id, { phone: '+919999999999' });
    expect(resubmitted.status).toBe(CompanyStatus.PENDING);
    expect(resubmitted.rejectionReason).toBeNull();
  });

  // â”€â”€ getDashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('getDashboard: returns company with zero KPIs (S2 placeholder)', async () => {
    if (dockerUnavailable) return;
    const user = await makeEmployerUser();
    await employerService.register(user.id, BASE_DTO);

    const dashboard = await employerService.getDashboard(user.id);
    expect(dashboard.company).toBeTruthy();
    expect(dashboard.kpis.activeJobs).toBe(0);
    expect(dashboard.recentJobs).toHaveLength(0);
    expect(dashboard.recentApplicants).toHaveLength(0);
  });
});


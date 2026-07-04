/**
 * Tests for EmployerProfileService.
 *
 * Section 1 — Unit: computeChecklist pure function (no DB).
 * Section 2 — Unit: hiring preferences upsert + logo presign/confirm (Prisma mocked).
 * Section 3 — Integration (Testcontainers PG): contact CRUD + single-primary rule.
 *
 * Docker-skip pattern: any test in Section 3 skips gracefully when Docker is unavailable.
 */
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CompanyStatus,
  CompanyType,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { computeChecklist, EmployerProfileService } from './employer-profile.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { EmployerService } from './employer.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

// ── Section 1: computeChecklist (pure function — no DB needed) ─────────────

describe('computeChecklist (pure function)', () => {
  const baseCompany = {
    id: 'c1',
    name: 'Test Corp',
    type: CompanyType.LOCAL,
    status: CompanyStatus.APPROVED,
    registrationNumber: 'R1',
    industryType: 'Construction',
    phone: '+91000',
    location: 'Mumbai',
    employeeRange: '1-10',
    languagePref: [],
    logoKey: null,
    description: null,
    website: null,
    rejectionReason: null,
    approvedAt: null,
    reviewedById: null,
    suspendedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;

  const basePrefs = {
    id: 'hp1',
    companyId: 'c1',
    categories: [],
    preferredExp: null,
    jobMarketsPosted: [],
    countriesHiredFrom: [],
    languagesRequired: [],
    updatedAt: new Date(),
  } as const;

  const makeContact = (id: string, isPrimary = false) =>
    ({
      id,
      companyId: 'c1',
      name: 'John',
      designation: null,
      phone: null,
      email: null,
      hasWhatsapp: false,
      isPrimary,
      createdAt: new Date(),
    }) as const;

  it('all false when company is bare: no logo, no description, no prefs, no contacts', () => {
    const result = computeChecklist(baseCompany as any, null, []);
    expect(result.hasLogo).toBe(false);
    expect(result.hasDescription).toBe(false);
    expect(result.hasHiringPreferences).toBe(false);
    expect(result.hasSecondContact).toBe(false);
    expect(result.hint).toBeTruthy();
  });

  it('hasLogo flips to true when logoKey is set', () => {
    const result = computeChecklist({ ...baseCompany, logoKey: 'companies/c1/logo/x.jpg' } as any, null, []);
    expect(result.hasLogo).toBe(true);
  });

  it('hasDescription flips to true when description is non-empty', () => {
    const result = computeChecklist({ ...baseCompany, description: 'We hire globally.' } as any, null, []);
    expect(result.hasDescription).toBe(true);
  });

  it('hasDescription is false for whitespace-only description', () => {
    const result = computeChecklist({ ...baseCompany, description: '   ' } as any, null, []);
    expect(result.hasDescription).toBe(false);
  });

  it('hasHiringPreferences flips to true when prefs row exists', () => {
    const result = computeChecklist(baseCompany as any, basePrefs as any, []);
    expect(result.hasHiringPreferences).toBe(true);
  });

  it('hasSecondContact requires at least 2 contacts', () => {
    expect(computeChecklist(baseCompany as any, null, [makeContact('a')]).hasSecondContact).toBe(false);
    expect(computeChecklist(baseCompany as any, null, [makeContact('a'), makeContact('b')]).hasSecondContact).toBe(true);
  });

  it('hint picks the first failing check (logo → description → prefs → second contact)', () => {
    // only logo missing
    const noLogo = computeChecklist(
      { ...baseCompany, description: 'desc' } as any,
      basePrefs as any,
      [makeContact('a'), makeContact('b')],
    );
    expect(noLogo.hint).toMatch(/logo/i);

    // logo present, description missing
    const noDesc = computeChecklist(
      { ...baseCompany, logoKey: 'k' } as any,
      basePrefs as any,
      [makeContact('a'), makeContact('b')],
    );
    expect(noDesc.hint).toMatch(/description/i);

    // logo + desc, prefs missing
    const noPrefs = computeChecklist(
      { ...baseCompany, logoKey: 'k', description: 'desc' } as any,
      null,
      [makeContact('a'), makeContact('b')],
    );
    expect(noPrefs.hint).toMatch(/hiring preference/i);

    // logo + desc + prefs, only one contact
    const oneContact = computeChecklist(
      { ...baseCompany, logoKey: 'k', description: 'desc' } as any,
      basePrefs as any,
      [makeContact('a')],
    );
    expect(oneContact.hint).toMatch(/second contact/i);
  });

  it('hint is null when all checks pass', () => {
    const result = computeChecklist(
      { ...baseCompany, logoKey: 'k', description: 'desc' } as any,
      basePrefs as any,
      [makeContact('a'), makeContact('b')],
    );
    expect(result.hint).toBeNull();
  });
});

// ── Section 2: prefs upsert + logo (unit — mocked dependencies) ───────────

describe('EmployerProfileService — prefs + logo (mocked Prisma)', () => {
  let service: EmployerProfileService;
  let mockPrisma: jest.Mocked<any>;
  let mockStorage: jest.Mocked<Pick<StorageService, 'presignPut' | 'presignGet' | 'headObject'>>;
  let mockAudit: jest.Mocked<Pick<AuditService, 'log'>>;
  let mockEmployerService: jest.Mocked<Pick<EmployerService, 'getCompanyForEmployerUser'>>;

  const fakeCompany = {
    id: 'company-uuid',
    name: 'Corp',
    logoKey: null,
    description: null,
  };

  beforeEach(() => {
    mockPrisma = {
      hiringPreference: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      contactPerson: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      jobCategory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      company: {
        update: jest.fn(),
      },
    };

    mockStorage = {
      presignPut: jest.fn().mockResolvedValue({ url: 'https://r2.example/put', expiresInSeconds: 300 }),
      presignGet: jest.fn().mockResolvedValue('https://r2.example/get'),
      headObject: jest.fn().mockResolvedValue({ sizeBytes: 512 * 1024, contentType: 'image/jpeg' }),
    };

    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockEmployerService = {
      getCompanyForEmployerUser: jest.fn().mockResolvedValue(fakeCompany),
    };

    service = new EmployerProfileService(
      mockPrisma as unknown as PrismaService,
      mockStorage as unknown as StorageService,
      mockAudit as unknown as AuditService,
      mockEmployerService as unknown as EmployerService,
    );
  });

  // ── hiring prefs ───────────────────────────────────────────────────────────

  it('upsertHiringPreferences: creates a row on first call (no existing prefs)', async () => {
    const fakePref = {
      id: 'pref-1',
      companyId: 'company-uuid',
      categories: ['cat-uuid'],
      preferredExp: '2',
      jobMarketsPosted: [],
      countriesHiredFrom: ['Indian'],
      languagesRequired: [],
      updatedAt: new Date(),
    };
    mockPrisma.jobCategory.findMany.mockResolvedValue([{ id: 'cat-uuid' }]);
    mockPrisma.hiringPreference.upsert.mockResolvedValue(fakePref);

    const result = await service.upsertHiringPreferences('user-1', {
      preferredCategories: ['cat-uuid'],
      preferredNationalities: ['Indian'],
      minExperience: 2,
    });

    expect(mockPrisma.hiringPreference.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.hiringPreference.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ companyId: 'company-uuid' });
    expect(call.create.categories).toEqual(['cat-uuid']);
    expect(call.create.preferredExp).toBe('2');
    expect(result.preferredCategories).toEqual(['cat-uuid']);
    expect(result.minExperience).toBe(2);
  });

  it('upsertHiringPreferences: upsert on second call produces one row (idempotent)', async () => {
    const fakePref = {
      id: 'pref-1',
      companyId: 'company-uuid',
      categories: ['cat-uuid'],
      preferredExp: '3',
      jobMarketsPosted: [],
      countriesHiredFrom: [],
      languagesRequired: [],
      updatedAt: new Date(),
    };
    mockPrisma.jobCategory.findMany.mockResolvedValue([{ id: 'cat-uuid' }]);
    mockPrisma.hiringPreference.upsert.mockResolvedValue(fakePref);

    await service.upsertHiringPreferences('user-1', { preferredCategories: ['cat-uuid'], minExperience: 2 });
    await service.upsertHiringPreferences('user-1', { preferredCategories: ['cat-uuid'], minExperience: 3 });

    // Both calls route through upsert; the DB ensures one-per-company via unique constraint
    expect(mockPrisma.hiringPreference.upsert).toHaveBeenCalledTimes(2);
  });

  it('upsertHiringPreferences: invalid category UUID → 422 INVALID_CATEGORY_IDS', async () => {
    mockPrisma.jobCategory.findMany.mockResolvedValue([]); // none found

    await expect(
      service.upsertHiringPreferences('user-1', {
        preferredCategories: ['00000000-0000-0000-0000-000000000000'],
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // ── logo presign / confirm ─────────────────────────────────────────────────

  it('presignLogo: returns uploadUrl + key scoped to company', async () => {
    const result = await service.presignLogo('user-1', {
      fileName: 'logo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100_000,
    });

    expect(result.uploadUrl).toBe('https://r2.example/put');
    expect(result.key).toMatch(/^companies\/company-uuid\/logo\//);
    expect(result.key).toMatch(/\.jpg$/);
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it('presignLogo: rejects disallowed MIME type at presign time', async () => {
    await expect(
      service.presignLogo('user-1', {
        fileName: 'logo.gif',
        mimeType: 'image/gif',
        sizeBytes: 100_000,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('confirmLogo: HEAD-revalidates, persists HEAD values, sets logoKey', async () => {
    const key = 'companies/company-uuid/logo/abc.jpg';
    await service.confirmLogo('user-1', { key });

    expect(mockStorage.headObject).toHaveBeenCalledWith(key);
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { logoKey: key } }),
    );
  });

  it('confirmLogo: key from a different company → 403 KEY_NOT_OWNED', async () => {
    await expect(
      service.confirmLogo('user-1', { key: 'companies/other-company/logo/x.jpg' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('confirmLogo: object missing in R2 → 422 UPLOAD_NOT_FOUND', async () => {
    mockStorage.headObject.mockResolvedValueOnce(null);
    const key = 'companies/company-uuid/logo/missing.jpg';
    await expect(service.confirmLogo('user-1', { key })).rejects.toThrow(UnprocessableEntityException);
  });

  it('confirmLogo: HEAD returns oversized object → 422 FILE_TOO_LARGE', async () => {
    mockStorage.headObject.mockResolvedValueOnce({ sizeBytes: 3 * 1024 * 1024, contentType: 'image/jpeg' });
    const key = 'companies/company-uuid/logo/big.jpg';
    await expect(service.confirmLogo('user-1', { key })).rejects.toThrow(UnprocessableEntityException);
  });
});

// ── Section 3: contacts CRUD + single-primary (integration, Testcontainers) ──

let pg: StartedTestContainer;
let prisma: PrismaClient;
let profileService: EmployerProfileService;
let dockerUnavailable = false;

const mockStorage2: jest.Mocked<Pick<StorageService, 'presignPut' | 'presignGet' | 'headObject'>> = {
  presignPut: jest.fn().mockResolvedValue({ url: 'https://r2.example/put', expiresInSeconds: 300 }),
  presignGet: jest.fn().mockResolvedValue('https://r2.example/get'),
  headObject: jest.fn().mockResolvedValue({ sizeBytes: 512 * 1024, contentType: 'image/jpeg' }),
};

const mockAudit2: jest.Mocked<Pick<AuditService, 'log'>> = {
  log: jest.fn().mockResolvedValue(undefined),
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

    const realEmployerService = new EmployerService(
      prisma as unknown as PrismaService,
      mockStorage2 as unknown as StorageService,
    );

    profileService = new EmployerProfileService(
      prisma as unknown as PrismaService,
      mockStorage2 as unknown as StorageService,
      mockAudit2 as unknown as AuditService,
      realEmployerService,
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
      console.warn('[integration] Docker unavailable — contact tests skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
});

async function makeEmployerWithCompany() {
  const user = await prisma.user.create({
    data: {
      email: `emp-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      role: UserRole.EMPLOYER,
      status: UserStatus.ACTIVE,
    },
  });
  const company = await prisma.company.create({
    data: {
      name: 'Test Corp',
      type: CompanyType.LOCAL,
      status: CompanyStatus.APPROVED,
      registrationNumber: 'REG1',
      industryType: 'Construction',
      phone: '+91000',
      location: 'Mumbai',
      employeeRange: '1-10',
    },
  });
  await prisma.employerUser.create({
    data: { userId: user.id, companyId: company.id, isPrimary: true },
  });
  return { user, company };
}

describe('EmployerProfileService — contacts (Testcontainers PG)', () => {
  beforeEach(async () => {
    if (dockerUnavailable) return;
    await prisma.contactPerson.deleteMany();
    await prisma.employerUser.deleteMany();
    await prisma.company.deleteMany();
    await prisma.user.deleteMany();
    jest.clearAllMocks();
  });

  it('createContact: creates a contact record', async () => {
    if (dockerUnavailable) return;
    const { user } = await makeEmployerWithCompany();

    const contact = await profileService.createContact(user.id, {
      name: 'Rajesh Mehta',
      role: 'HR Manager',
      phone: '+971501234567',
      email: 'rajesh@corp.example',
      isPrimary: false,
    });

    expect(contact.id).toBeTruthy();
    expect(contact.name).toBe('Rajesh Mehta');
    expect(contact.role).toBe('HR Manager');
    expect(contact.isPrimary).toBe(false);
    expect(contact.createdAt).toBeTruthy();
  });

  it('single-primary rule: setting new primary demotes the old one atomically', async () => {
    if (dockerUnavailable) return;
    const { user, company } = await makeEmployerWithCompany();

    // Create initial primary
    await profileService.createContact(user.id, {
      name: 'First Primary',
      role: 'Director',
      isPrimary: true,
    });

    // Create second contact as primary — must demote the first
    await profileService.createContact(user.id, {
      name: 'New Primary',
      role: 'HR Lead',
      isPrimary: true,
    });

    const contacts = await prisma.contactPerson.findMany({ where: { companyId: company.id } });

    // Exactly one primary at all times
    const primaries = contacts.filter((c) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.name).toBe('New Primary');
  });

  it('updateContact: setting isPrimary=true demotes previous primary atomically', async () => {
    if (dockerUnavailable) return;
    const { user, company } = await makeEmployerWithCompany();

    const first = await profileService.createContact(user.id, {
      name: 'Alpha',
      role: 'Manager',
      isPrimary: true,
    });
    const second = await profileService.createContact(user.id, {
      name: 'Beta',
      role: 'Assistant',
      isPrimary: false,
    });

    await profileService.updateContact(user.id, second.id, { isPrimary: true });

    const contacts = await prisma.contactPerson.findMany({ where: { companyId: company.id } });
    const primaries = contacts.filter((c) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.id).toBe(second.id);

    const firstRow = contacts.find((c) => c.id === first.id);
    expect(firstRow!.isPrimary).toBe(false);
  });

  it('deleteContact: removes the record; deleting primary leaves zero primaries (allowed)', async () => {
    if (dockerUnavailable) return;
    const { user, company } = await makeEmployerWithCompany();

    const c = await profileService.createContact(user.id, {
      name: 'To Delete',
      role: 'Sales',
      isPrimary: true,
    });

    await profileService.deleteContact(user.id, c.id);

    const remaining = await prisma.contactPerson.findMany({ where: { companyId: company.id } });
    expect(remaining).toHaveLength(0);
  });

  it('cross-company contact access → 404 (not 403 — no existence leak)', async () => {
    if (dockerUnavailable) return;
    const { user: user1 } = await makeEmployerWithCompany();
    const { user: user2, company: company2 } = await makeEmployerWithCompany();

    // Contact belongs to company2
    const victimContact = await prisma.contactPerson.create({
      data: { companyId: company2.id, name: 'Victim', designation: 'Staff', isPrimary: false },
    });

    // user1 tries to update company2's contact — must get 404, not 403
    await expect(
      profileService.updateContact(user1.id, victimContact.id, { name: 'Hacked' }),
    ).rejects.toThrow(NotFoundException);

    // Victim row must be unchanged
    const victim = await prisma.contactPerson.findUnique({ where: { id: victimContact.id } });
    expect(victim!.name).toBe('Victim');
  });
});

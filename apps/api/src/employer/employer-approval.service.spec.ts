/**
 * Unit tests for EmployerApprovalService — state machine transitions.
 * No Docker required — all DB + audit + emitter are mocked.
 *
 * Covers: all legal transitions, illegal transition → 409, reject without
 * reason → 422, each transition AUDITS and EMITS the correct event.
 */
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Company, CompanyStatus, CompanyType, UserRole } from '@prisma/client';
import { EmployerApprovalService } from './employer-approval.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EMPLOYER_EVENTS } from './employer.events';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comp-1',
    name: 'Test Corp',
    type: CompanyType.LOCAL,
    status: CompanyStatus.PENDING,
    registrationNumber: 'REG1',
    industryType: 'IT',
    phone: '+91111',
    location: 'Delhi',
    website: null,
    employeeRange: '10-50',
    languagePref: [],
    description: null,
    logoKey: null,
    rejectionReason: null,
    approvedAt: null,
    reviewedById: null,
    suspendedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock(company: Company) {
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue(company),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...company, ...data })),
    },
    employerUser: {
      findFirst: jest.fn().mockResolvedValue({ userId: 'user-1', companyId: company.id }),
    },
  };
}

const ADMIN_ID = 'admin-1';
const ADMIN_ROLE = UserRole.ADMIN;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EmployerApprovalService — state machine (unit)', () => {
  let auditMock: jest.Mocked<Pick<AuditService, 'log'>>;
  let emitterMock: jest.Mocked<Pick<EventEmitter2, 'emit'>>;

  beforeEach(() => {
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    emitterMock = { emit: jest.fn().mockReturnValue(true) };
  });

  function makeService(company: Company): EmployerApprovalService {
    return new EmployerApprovalService(
      makePrismaMock(company) as unknown as PrismaService,
      auditMock as unknown as AuditService,
      emitterMock as unknown as EventEmitter2,
    );
  }

  // ── PENDING → APPROVED ───────────────────────────────────────────────────

  it('approve: PENDING → APPROVED succeeds, updates company, audits, emits', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    const result = await service.approve('comp-1', ADMIN_ID, ADMIN_ROLE);

    expect(result.status).toBe(CompanyStatus.APPROVED);
    expect(auditMock.log).toHaveBeenCalledTimes(1);
    expect(emitterMock.emit).toHaveBeenCalledWith(EMPLOYER_EVENTS.APPROVED, expect.objectContaining({
      companyId: 'comp-1',
      userId: 'user-1',
    }));
  });

  // ── PENDING → REJECTED ───────────────────────────────────────────────────

  it('reject: PENDING → REJECTED succeeds and stores reason', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    const result = await service.reject('comp-1', 'Docs invalid', ADMIN_ID, ADMIN_ROLE);

    expect(result.status).toBe(CompanyStatus.REJECTED);
    expect(auditMock.log).toHaveBeenCalledTimes(1);
    expect(emitterMock.emit).toHaveBeenCalledWith(EMPLOYER_EVENTS.REJECTED, expect.objectContaining({
      reason: 'Docs invalid',
    }));
  });

  it('reject: missing reason → 422 REJECTION_REASON_REQUIRED', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    await expect(service.reject('comp-1', '', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('reject: whitespace-only reason → 422', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    await expect(service.reject('comp-1', '   ', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  // ── REJECTED → PENDING ───────────────────────────────────────────────────

  it('approve on REJECTED company → 409 ILLEGAL_EMPLOYER_TRANSITION', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.REJECTED }));
    await expect(service.approve('comp-1', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      ConflictException,
    );
  });

  // ── APPROVED → SUSPENDED ─────────────────────────────────────────────────

  it('suspend: APPROVED → SUSPENDED succeeds, audits, emits', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.APPROVED }));
    const result = await service.suspend('comp-1', ADMIN_ID, ADMIN_ROLE);

    expect(result.status).toBe(CompanyStatus.SUSPENDED);
    expect(auditMock.log).toHaveBeenCalledTimes(1);
    expect(emitterMock.emit).toHaveBeenCalledWith(EMPLOYER_EVENTS.SUSPENDED, expect.objectContaining({
      companyId: 'comp-1',
    }));
  });

  it('suspend on PENDING company → 409 ILLEGAL_EMPLOYER_TRANSITION', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    await expect(service.suspend('comp-1', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      ConflictException,
    );
  });

  // ── SUSPENDED → APPROVED (reactivate) ────────────────────────────────────

  it('reactivate: SUSPENDED → APPROVED succeeds, audits, emits', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.SUSPENDED }));
    const result = await service.reactivate('comp-1', ADMIN_ID, ADMIN_ROLE);

    expect(result.status).toBe(CompanyStatus.APPROVED);
    expect(auditMock.log).toHaveBeenCalledTimes(1);
    expect(emitterMock.emit).toHaveBeenCalledWith(EMPLOYER_EVENTS.REACTIVATED, expect.objectContaining({
      companyId: 'comp-1',
    }));
  });

  it('reactivate on PENDING company → 409 ILLEGAL_EMPLOYER_TRANSITION', async () => {
    const service = makeService(makeCompany({ status: CompanyStatus.PENDING }));
    await expect(service.reactivate('comp-1', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      ConflictException,
    );
  });

  // ── Company not found ─────────────────────────────────────────────────────

  it('approve on unknown companyId → 404 COMPANY_NOT_FOUND', async () => {
    const prismaMock = {
      company: { findUnique: jest.fn().mockResolvedValue(null) },
      employerUser: { findFirst: jest.fn() },
    };
    const service = new EmployerApprovalService(
      prismaMock as unknown as PrismaService,
      auditMock as unknown as AuditService,
      emitterMock as unknown as EventEmitter2,
    );
    await expect(service.approve('unknown-id', ADMIN_ID, ADMIN_ROLE)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── Audit must fire on each legal transition ──────────────────────────────

  it('each legal transition fires exactly one audit log entry', async () => {
    const cases: Array<[CompanyStatus, () => Promise<Company>]> = [
      [
        CompanyStatus.PENDING,
        () => makeService(makeCompany({ status: CompanyStatus.PENDING })).approve('comp-1', ADMIN_ID, ADMIN_ROLE),
      ],
      [
        CompanyStatus.PENDING,
        () => makeService(makeCompany({ status: CompanyStatus.PENDING })).reject('comp-1', 'reason', ADMIN_ID, ADMIN_ROLE),
      ],
      [
        CompanyStatus.APPROVED,
        () => makeService(makeCompany({ status: CompanyStatus.APPROVED })).suspend('comp-1', ADMIN_ID, ADMIN_ROLE),
      ],
      [
        CompanyStatus.SUSPENDED,
        () => makeService(makeCompany({ status: CompanyStatus.SUSPENDED })).reactivate('comp-1', ADMIN_ID, ADMIN_ROLE),
      ],
    ];

    for (const [, action] of cases) {
      jest.clearAllMocks();
      auditMock.log.mockResolvedValue(undefined);
      await action();
      expect(auditMock.log).toHaveBeenCalledTimes(1);
    }
  });

  // ── Reject reason is stored on the company ────────────────────────────────

  it('reject: rejectionReason from the call is stored on the company update', async () => {
    const prismaMock = makePrismaMock(makeCompany({ status: CompanyStatus.PENDING }));
    const service = new EmployerApprovalService(
      prismaMock as unknown as PrismaService,
      auditMock as unknown as AuditService,
      emitterMock as unknown as EventEmitter2,
    );

    await service.reject('comp-1', 'Documents are expired', ADMIN_ID, ADMIN_ROLE);

    const updateCall = (prismaMock.company.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.rejectionReason).toBe('Documents are expired');
    expect(updateCall.data.status).toBe(CompanyStatus.REJECTED);
  });
});

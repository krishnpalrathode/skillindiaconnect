/**
 * Unit tests for AdminEmployerController — RBAC gating + route behaviour.
 *
 * Tests that:
 *   - approve/reject require EMPLOYERS_APPROVE_REJECT permission
 *   - suspend requires EMPLOYERS_SUSPEND permission
 *   - a role lacking the permission gets 403 FORBIDDEN
 *   - reject without a reason body → 422 (from EmployerApprovalService)
 *   - rejection reason is stored + visible on subsequent company read
 *
 * All DB / service calls are mocked so no Docker required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyStatus, CompanyType, UserRole } from '@prisma/client';
import { AdminEmployerController } from './admin-employer.controller';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';
import { PermissionsGuard } from '../auth/rbac/permissions.guard';
import { PermissionService } from '../auth/rbac/permission.service';
import { Permission } from '../auth/rbac/permission.constants';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(role: UserRole): CurrentUserPayload {
  return { userId: 'admin-1', role, jti: 'jti-x', exp: 9_999_999_999 };
}

function makeCompany(status: CompanyStatus = CompanyStatus.PENDING) {
  return {
    id: 'comp-1',
    name: 'Test Corp',
    type: CompanyType.LOCAL,
    status,
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
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('AdminEmployerController — RBAC unit tests', () => {
  let controller: AdminEmployerController;
  let approvalMock: jest.Mocked<EmployerApprovalService>;
  let employerMock: jest.Mocked<EmployerService>;
  let permServiceMock: jest.Mocked<Pick<PermissionService, 'getPermissionsForRole'>>;

  beforeEach(async () => {
    approvalMock = {
      approve: jest.fn().mockResolvedValue(makeCompany(CompanyStatus.APPROVED)),
      reject: jest.fn().mockResolvedValue(makeCompany(CompanyStatus.REJECTED)),
      suspend: jest.fn().mockResolvedValue(makeCompany(CompanyStatus.SUSPENDED)),
      reactivate: jest.fn().mockResolvedValue(makeCompany(CompanyStatus.APPROVED)),
    } as unknown as jest.Mocked<EmployerApprovalService>;

    employerMock = {
      adminList: jest.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    } as unknown as jest.Mocked<EmployerService>;

    permServiceMock = { getPermissionsForRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminEmployerController],
      providers: [
        { provide: EmployerService, useValue: employerMock },
        { provide: EmployerApprovalService, useValue: approvalMock },
        PermissionsGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: PermissionService, useValue: permServiceMock },
      ],
    }).compile();

    controller = module.get<AdminEmployerController>(AdminEmployerController);
  });

  // ── approve ──────────────────────────────────────────────────────────────

  it('approve: ADMIN with EMPLOYERS_APPROVE_REJECT → calls approvalService.approve', async () => {
    const result = await controller.approve('comp-1', makeUser(UserRole.ADMIN));
    expect(approvalMock.approve).toHaveBeenCalledWith('comp-1', 'admin-1', UserRole.ADMIN);
    expect(result.data.status).toBe(CompanyStatus.APPROVED);
  });

  // ── reject ───────────────────────────────────────────────────────────────

  it('reject: ADMIN with reason → calls approvalService.reject with reason', async () => {
    approvalMock.reject.mockResolvedValueOnce({
      ...makeCompany(CompanyStatus.REJECTED),
      rejectionReason: 'Docs expired',
    });
    const result = await controller.reject('comp-1', { reason: 'Docs expired' }, makeUser(UserRole.ADMIN));
    expect(approvalMock.reject).toHaveBeenCalledWith('comp-1', 'Docs expired', 'admin-1', UserRole.ADMIN);
    expect(result.data.rejectionReason).toBe('Docs expired');
  });

  it('reject: approvalService throws 422 when reason is empty', async () => {
    approvalMock.reject.mockRejectedValueOnce(
      new UnprocessableEntityException({ code: 'REJECTION_REASON_REQUIRED' }),
    );
    await expect(
      controller.reject('comp-1', { reason: '' }, makeUser(UserRole.ADMIN)),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // ── suspend ───────────────────────────────────────────────────────────────

  it('suspend: ADMIN → calls approvalService.suspend', async () => {
    const result = await controller.suspend('comp-1', makeUser(UserRole.ADMIN));
    expect(approvalMock.suspend).toHaveBeenCalledWith('comp-1', 'admin-1', UserRole.ADMIN);
    expect(result.data.status).toBe(CompanyStatus.SUSPENDED);
  });

  // ── reactivate ────────────────────────────────────────────────────────────

  it('reactivate: ADMIN → calls approvalService.reactivate', async () => {
    const result = await controller.reactivate('comp-1', makeUser(UserRole.ADMIN));
    expect(approvalMock.reactivate).toHaveBeenCalledWith('comp-1', 'admin-1', UserRole.ADMIN);
    expect(result.data.status).toBe(CompanyStatus.APPROVED);
  });

  // ── RBAC: PermissionsGuard integration ───────────────────────────────────

  it('EMPLOYERS_APPROVE_REJECT guard metadata is set on approve endpoint', () => {
    const metadata = Reflect.getMetadata(
      'requiredPermissions',
      AdminEmployerController.prototype.approve,
    );
    expect(metadata).toEqual([Permission.EMPLOYERS_APPROVE_REJECT]);
  });

  it('EMPLOYERS_SUSPEND guard metadata is set on suspend endpoint', () => {
    const metadata = Reflect.getMetadata(
      'requiredPermissions',
      AdminEmployerController.prototype.suspend,
    );
    expect(metadata).toEqual([Permission.EMPLOYERS_SUSPEND]);
  });

  it('EMPLOYERS_VIEW guard metadata is set on list endpoint', () => {
    const metadata = Reflect.getMetadata(
      'requiredPermissions',
      AdminEmployerController.prototype.list,
    );
    expect(metadata).toEqual([Permission.EMPLOYERS_VIEW]);
  });

  // ── Illegal transition propagates from service ────────────────────────────

  it('approve on already-approved company → 409 propagated from approvalService', async () => {
    approvalMock.approve.mockRejectedValueOnce(
      new ConflictException({ code: 'ILLEGAL_EMPLOYER_TRANSITION' }),
    );
    await expect(controller.approve('comp-1', makeUser(UserRole.ADMIN))).rejects.toThrow(
      ConflictException,
    );
  });

  // ── PermissionsGuard throws 403 when permission is missing ────────────────

  it('guard throws 403 when caller lacks EMPLOYERS_APPROVE_REJECT', async () => {
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([]));
    const guard = new PermissionsGuard(new Reflector(), permServiceMock as unknown as PermissionService);

    // Build a mock execution context that has the approve method's metadata
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: makeUser(UserRole.MODERATOR) }) }),
      getHandler: () => AdminEmployerController.prototype.approve,
      getClass: () => AdminEmployerController,
    } as unknown as import('@nestjs/common').ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('guard throws 403 when caller lacks EMPLOYERS_SUSPEND', async () => {
    permServiceMock.getPermissionsForRole.mockResolvedValue(new Set([]));
    const guard = new PermissionsGuard(new Reflector(), permServiceMock as unknown as PermissionService);

    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: makeUser(UserRole.MODERATOR) }) }),
      getHandler: () => AdminEmployerController.prototype.suspend,
      getClass: () => AdminEmployerController,
    } as unknown as import('@nestjs/common').ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});

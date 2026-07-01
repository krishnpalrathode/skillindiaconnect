import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Company, CompanyStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import {
  EMPLOYER_EVENTS,
  EmployerApprovedPayload,
  EmployerRejectedPayload,
  EmployerSuspendedPayload,
  EmployerReactivatedPayload,
} from './employer.events';

// Legal state-machine transitions
const LEGAL_TRANSITIONS: Record<CompanyStatus, CompanyStatus[]> = {
  PENDING: [CompanyStatus.APPROVED, CompanyStatus.REJECTED],
  APPROVED: [CompanyStatus.SUSPENDED],
  REJECTED: [CompanyStatus.PENDING],
  SUSPENDED: [CompanyStatus.APPROVED],
};

@Injectable()
export class EmployerApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async approve(
    companyId: string,
    adminUserId: string,
    adminRole: UserRole,
  ): Promise<Company> {
    const company = await this.loadAndAssertTransition(companyId, CompanyStatus.APPROVED);

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        status: CompanyStatus.APPROVED,
        approvedAt: new Date(),
        reviewedById: adminUserId,
        rejectionReason: null,
      },
    });

    const primaryUser = await this.getPrimaryUser(companyId);

    await this.audit.log({
      actorUserId: adminUserId,
      actorRole: adminRole,
      action: AUDIT_ACTIONS.EMPLOYER_APPROVED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: companyId,
      status: AuditStatus.SUCCESS,
      meta: { companyName: company.name },
    });

    const payload: EmployerApprovedPayload = {
      companyId,
      companyName: company.name,
      userId: primaryUser.userId,
    };
    this.events.emit(EMPLOYER_EVENTS.APPROVED, payload);

    return updated;
  }

  async reject(
    companyId: string,
    reason: string,
    adminUserId: string,
    adminRole: UserRole,
  ): Promise<Company> {
    if (!reason || reason.trim().length === 0) {
      throw new UnprocessableEntityException({ code: 'REJECTION_REASON_REQUIRED' });
    }

    const company = await this.loadAndAssertTransition(companyId, CompanyStatus.REJECTED);

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        status: CompanyStatus.REJECTED,
        rejectionReason: reason,
        reviewedById: adminUserId,
        approvedAt: null,
      },
    });

    const primaryUser = await this.getPrimaryUser(companyId);

    await this.audit.log({
      actorUserId: adminUserId,
      actorRole: adminRole,
      action: AUDIT_ACTIONS.EMPLOYER_REJECTED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: companyId,
      status: AuditStatus.SUCCESS,
      meta: { companyName: company.name },
    });

    const payload: EmployerRejectedPayload = {
      companyId,
      companyName: company.name,
      userId: primaryUser.userId,
      reason,
    };
    this.events.emit(EMPLOYER_EVENTS.REJECTED, payload);

    return updated;
  }

  async suspend(
    companyId: string,
    adminUserId: string,
    adminRole: UserRole,
  ): Promise<Company> {
    const company = await this.loadAndAssertTransition(companyId, CompanyStatus.SUSPENDED);

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        status: CompanyStatus.SUSPENDED,
        suspendedAt: new Date(),
        reviewedById: adminUserId,
      },
    });

    const primaryUser = await this.getPrimaryUser(companyId);

    await this.audit.log({
      actorUserId: adminUserId,
      actorRole: adminRole,
      action: AUDIT_ACTIONS.EMPLOYER_SUSPENDED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: companyId,
      status: AuditStatus.SUCCESS,
      meta: { companyName: company.name },
    });

    const payload: EmployerSuspendedPayload = {
      companyId,
      companyName: company.name,
      userId: primaryUser.userId,
    };
    // B5 (Jobs) subscribes to this event and pauses the company's active jobs.
    this.events.emit(EMPLOYER_EVENTS.SUSPENDED, payload);

    return updated;
  }

  async reactivate(
    companyId: string,
    adminUserId: string,
    adminRole: UserRole,
  ): Promise<Company> {
    // Reactivate is SUSPENDED→APPROVED only. Must load the company and assert
    // the current status is SUSPENDED before checking the general transition table.
    const company = await this.loadAndAssertFromStatus(companyId, CompanyStatus.SUSPENDED, CompanyStatus.APPROVED);

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        status: CompanyStatus.APPROVED,
        approvedAt: new Date(),
        suspendedAt: null,
        reviewedById: adminUserId,
      },
    });

    const primaryUser = await this.getPrimaryUser(companyId);

    await this.audit.log({
      actorUserId: adminUserId,
      actorRole: adminRole,
      action: AUDIT_ACTIONS.EMPLOYER_APPROVED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: companyId,
      status: AuditStatus.SUCCESS,
      meta: { companyName: company.name, action: 'reactivated' },
    });

    const payload: EmployerReactivatedPayload = {
      companyId,
      companyName: company.name,
      userId: primaryUser.userId,
    };
    this.events.emit(EMPLOYER_EVENTS.REACTIVATED, payload);

    return updated;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async loadAndAssertTransition(
    companyId: string,
    toStatus: CompanyStatus,
  ): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    const allowed = LEGAL_TRANSITIONS[company.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictException({
        code: 'ILLEGAL_EMPLOYER_TRANSITION',
        meta: { from: company.status, to: toStatus },
      });
    }
    return company;
  }

  /** Like loadAndAssertTransition but additionally requires current status to equal fromStatus. */
  private async loadAndAssertFromStatus(
    companyId: string,
    fromStatus: CompanyStatus,
    toStatus: CompanyStatus,
  ): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    if (company.status !== fromStatus) {
      throw new ConflictException({
        code: 'ILLEGAL_EMPLOYER_TRANSITION',
        meta: { from: company.status, to: toStatus },
      });
    }
    return company;
  }

  private async getPrimaryUser(companyId: string): Promise<{ userId: string }> {
    const link = await this.prisma.employerUser.findFirst({
      where: { companyId, isPrimary: true },
    });
    if (!link) {
      throw new NotFoundException({ code: 'EMPLOYER_USER_NOT_FOUND' });
    }
    return { userId: link.userId };
  }
}

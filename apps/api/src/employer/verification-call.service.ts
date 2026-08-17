import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CompanyStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { Permission } from '../auth/rbac/permission.constants';
import { ScheduleVerificationCallDto } from './dto/schedule-verification-call.dto';

/**
 * How far ahead a slot may be booked.
 *
 * The floor is "in the future at all" — a slot in the past is a data-entry
 * mistake, not a booking. The ceiling exists because the whole promise of this
 * feature is SPEED: an employer asking to skip a 24-hour queue by proposing a
 * call six months out has misunderstood it, and the request would sit in an
 * admin's list rotting. Thirty days is generous for "we are away next week".
 */
export const MAX_SLOT_DAYS_AHEAD = 30;

export interface VerificationCallView {
  slotAt: string;
  note: string | null;
  requestedAt: string;
}

/**
 * Employer-requested verification calls — the fast path around the review queue.
 *
 * The employer proposes a time; every admin who can actually approve companies
 * is notified in-app and by email. Nothing here approves anything: an admin
 * still makes that decision after the call, so this service books a
 * conversation, it does not grant status.
 */
@Injectable()
export class VerificationCallService {
  private readonly logger = new Logger(VerificationCallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Book (or re-book) the call.
   *
   * An UPSERT keyed on the company, so re-picking a time replaces the pending
   * request rather than raising a second one. That is what "reschedule" means
   * to the employer, and it also caps how much noise one company can make in an
   * admin's feed.
   */
  async schedule(
    userId: string,
    dto: ScheduleVerificationCallDto,
  ): Promise<VerificationCallView> {
    // The employer↔company link is the `employer_users` join, not a direct
    // relation on Company — same access path as EmployerService uses.
    const link = await this.prisma.employerUser.findUnique({
      where: { userId },
      select: { company: { select: { id: true, name: true, status: true } } },
    });
    const company = link?.company;
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    /*
      Only a company still waiting has anything to gain.

      An APPROVED company booking a verification call would occupy an admin to
      confirm something already true; a SUSPENDED or REJECTED one needs a
      different conversation entirely, and letting them book this would route a
      support problem into the approvals queue.
    */
    if (company.status !== CompanyStatus.PENDING) {
      throw new UnprocessableEntityException({
        code: 'VERIFICATION_CALL_NOT_APPLICABLE',
        detail: 'Only a company awaiting review can request a verification call.',
      });
    }

    const slotAt = new Date(dto.slotAt);
    if (Number.isNaN(slotAt.getTime())) {
      throw new UnprocessableEntityException({ code: 'INVALID_SLOT' });
    }

    const now = new Date();
    if (slotAt.getTime() <= now.getTime()) {
      throw new UnprocessableEntityException({ code: 'SLOT_IN_PAST' });
    }
    const maxAt = new Date(now.getTime() + MAX_SLOT_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    if (slotAt.getTime() > maxAt.getTime()) {
      throw new UnprocessableEntityException({
        code: 'SLOT_TOO_FAR',
        meta: { maxDaysAhead: MAX_SLOT_DAYS_AHEAD },
      });
    }

    const note = dto.note?.trim() || null;

    const row = await this.prisma.verificationCallRequest.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        requestedByUserId: userId,
        slotAt,
        note,
      },
      update: { requestedByUserId: userId, slotAt, note },
    });

    await this.notifyApprovers(company.id, company.name, slotAt, note);

    return {
      slotAt: row.slotAt.toISOString(),
      note: row.note,
      requestedAt: row.createdAt.toISOString(),
    };
  }

  /** The employer's current request, or null. Drives the banner state. */
  async current(userId: string): Promise<VerificationCallView | null> {
    const link = await this.prisma.employerUser.findUnique({
      where: { userId },
      select: { companyId: true },
    });
    if (!link) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const row = await this.prisma.verificationCallRequest.findUnique({
      where: { companyId: link.companyId },
    });
    if (!row) return null;

    return {
      slotAt: row.slotAt.toISOString(),
      note: row.note,
      requestedAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Fan out to the staff who can actually act on it.
   *
   * The recipient list is derived from RBAC — the roles whose
   * `employers.approve_reject` permission is enabled — rather than from a
   * hardcoded [SUPER_ADMIN, ADMIN, MODERATOR]. That list is editable by a
   * Super-Admin at runtime, so a literal here would silently start notifying
   * the wrong people the first time somebody changed the matrix.
   *
   * Never throws. The request is already committed by the time this runs, and
   * failing the employer's booking because an email provider was down would
   * lose the booking to protect the message about it. A failure is logged and
   * the row still stands.
   */
  private async notifyApprovers(
    companyId: string,
    companyName: string,
    slotAt: Date,
    note: string | null,
  ): Promise<void> {
    try {
      const roles = await this.prisma.rolePermission.findMany({
        where: { permissionKey: Permission.EMPLOYERS_APPROVE_REJECT, enabled: true },
        select: { role: true },
      });
      const approverRoles = roles.map((r) => r.role);
      if (approverRoles.length === 0) {
        this.logger.warn('no role holds employers.approve_reject — nobody to notify');
        return;
      }

      const admins = await this.prisma.user.findMany({
        where: {
          role: { in: approverRoles as UserRole[] },
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (admins.length === 0) {
        this.logger.warn('no active approver accounts — verification call unannounced');
        return;
      }

      // Sequential rather than Promise.all: this writes a row and enqueues an
      // email PER admin, and a burst of parallel writes buys nothing on a list
      // this small.
      for (const admin of admins) {
        await this.notifications.notify(admin.id, NotificationType.VERIFICATION_CALL_REQUESTED, {
          title: 'Verification call requested',
          body: `${companyName} asked for a verification call.`,
          data: {
            companyId,
            companyName,
            slotAt: slotAt.toISOString(),
            ...(note ? { note } : {}),
          },
        });
      }
    } catch (err) {
      // Deliberately swallowed — see the docblock.
      this.logger.error(
        `failed to notify approvers of verification call for company ${companyId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}

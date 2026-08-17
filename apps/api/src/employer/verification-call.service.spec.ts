/**
 * Employer-requested verification calls.
 *
 * Two things here are worth defending beyond the happy path:
 *
 *  1. WHO gets told. The recipient list is derived from RBAC rather than a
 *     hardcoded role list, because a Super-Admin can edit that matrix at
 *     runtime — a literal would quietly notify the wrong people the first time
 *     somebody changed it.
 *  2. That a notification failure does NOT lose the booking. The row is already
 *     committed when the fan-out runs, and throwing would trade the thing the
 *     employer asked for against the message about it.
 */
import { Test } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CompanyStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { Permission } from '../auth/rbac/permission.constants';
import { VerificationCallService, MAX_SLOT_DAYS_AHEAD } from './verification-call.service';

const USER_ID = 'employer-user-1';
const COMPANY = { id: 'company-1', name: 'Gulf Wiring LLC', status: CompanyStatus.PENDING };

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('VerificationCallService', () => {
  let service: VerificationCallService;
  let prisma: {
    employerUser: { findUnique: jest.Mock };
    verificationCallRequest: { upsert: jest.Mock; findUnique: jest.Mock };
    rolePermission: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notify: jest.Mock;

  beforeEach(async () => {
    prisma = {
      employerUser: {
        findUnique: jest.fn().mockResolvedValue({ company: COMPANY, companyId: COMPANY.id }),
      },
      verificationCallRequest: {
        upsert: jest.fn().mockImplementation(({ create, update }) => {
          const slotAt = create?.slotAt ?? update?.slotAt;
          return Promise.resolve({
            slotAt,
            note: create?.note ?? update?.note ?? null,
            createdAt: new Date('2026-08-17T09:00:00Z'),
          });
        }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      rolePermission: {
        findMany: jest.fn().mockResolvedValue([{ role: 'ADMIN' }, { role: 'MODERATOR' }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]),
      },
    };
    notify = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        VerificationCallService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { notify } },
      ],
    }).compile();

    service = moduleRef.get(VerificationCallService);
  });

  describe('booking rules', () => {
    it('books a future slot and returns it', async () => {
      const slot = inDays(2);
      const out = await service.schedule(USER_ID, { slotAt: slot });
      expect(new Date(out.slotAt).toISOString()).toBe(new Date(slot).toISOString());
    });

    it('re-booking UPSERTS on the company rather than stacking requests', async () => {
      await service.schedule(USER_ID, { slotAt: inDays(2) });
      await service.schedule(USER_ID, { slotAt: inDays(3) });

      // Twice through the same unique key — never a create-per-request, which
      // is what would let one employer flood the approvers' feed.
      expect(prisma.verificationCallRequest.upsert).toHaveBeenCalledTimes(2);
      for (const call of prisma.verificationCallRequest.upsert.mock.calls) {
        expect(call[0].where).toEqual({ companyId: COMPANY.id });
      }
    });

    it('rejects a slot in the past', async () => {
      await expect(service.schedule(USER_ID, { slotAt: inDays(-1) })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.verificationCallRequest.upsert).not.toHaveBeenCalled();
    });

    it(`rejects a slot more than ${MAX_SLOT_DAYS_AHEAD} days out`, async () => {
      // The feature's promise is speed; a booking months away is not that.
      await expect(
        service.schedule(USER_ID, { slotAt: inDays(MAX_SLOT_DAYS_AHEAD + 1) }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it.each([CompanyStatus.APPROVED, CompanyStatus.REJECTED, CompanyStatus.SUSPENDED])(
      'refuses when the company is %s — only PENDING has anything to gain',
      async (status) => {
        prisma.employerUser.findUnique.mockResolvedValue({ company: { ...COMPANY, status }, companyId: COMPANY.id });
        await expect(service.schedule(USER_ID, { slotAt: inDays(2) })).rejects.toThrow(
          UnprocessableEntityException,
        );
      },
    );

    it('404s when the user has no company', async () => {
      prisma.employerUser.findUnique.mockResolvedValue(null);
      await expect(service.schedule(USER_ID, { slotAt: inDays(2) })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('who gets notified', () => {
    it('notifies every active user in a role holding employers.approve_reject', async () => {
      await service.schedule(USER_ID, { slotAt: inDays(2), note: 'call after 6pm' });

      expect(prisma.rolePermission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { permissionKey: Permission.EMPLOYERS_APPROVE_REJECT, enabled: true },
        }),
      );
      // Roles come FROM that query — not from a literal list in the service.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: { in: ['ADMIN', 'MODERATOR'] } }),
        }),
      );

      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledWith(
        'admin-1',
        NotificationType.VERIFICATION_CALL_REQUESTED,
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY.id,
            companyName: COMPANY.name,
            note: 'call after 6pm',
          }),
        }),
      );
    });

    it('omits the note from the payload when there is none', async () => {
      await service.schedule(USER_ID, { slotAt: inDays(2) });
      const payload = notify.mock.calls[0]![2];
      expect(payload.data).not.toHaveProperty('note');
    });

    it('still books the call when nobody holds the permission', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);
      await expect(service.schedule(USER_ID, { slotAt: inDays(2) })).resolves.toBeDefined();
      expect(notify).not.toHaveBeenCalled();
    });

    it('KEEPS the booking when the notification fan-out throws', async () => {
      // The row is committed before this runs. Losing the booking to protect
      // the message about it would be exactly backwards.
      notify.mockRejectedValue(new Error('smtp down'));
      await expect(service.schedule(USER_ID, { slotAt: inDays(2) })).resolves.toMatchObject({
        slotAt: expect.any(String),
      });
      expect(prisma.verificationCallRequest.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('current', () => {
    it('returns null when nothing is booked', async () => {
      await expect(service.current(USER_ID)).resolves.toBeNull();
    });

    it('returns the pending request', async () => {
      prisma.verificationCallRequest.findUnique.mockResolvedValue({
        slotAt: new Date('2026-08-20T10:00:00Z'),
        note: 'ring the office',
        createdAt: new Date('2026-08-17T09:00:00Z'),
      });
      await expect(service.current(USER_ID)).resolves.toEqual({
        slotAt: '2026-08-20T10:00:00.000Z',
        note: 'ring the office',
        requestedAt: '2026-08-17T09:00:00.000Z',
      });
    });
  });
});

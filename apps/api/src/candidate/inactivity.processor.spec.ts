/**
 * The 30-day "are you still looking?" scan.
 *
 * The whole risk of a re-engagement job is sending it to the wrong person or
 * sending it twice, so that is what these test:
 *
 *  - the send-once guard, which has no column and is a query against the
 *    notifications table keyed on lastLoginAt;
 *  - that signing in RE-ARMS it, so a candidate who lapses twice is asked
 *    twice and one who came back yesterday is not asked at all;
 *  - that a never-logged-in account is measured from signup, not nagged on the
 *    day its 30-day-old registration crosses the line;
 *  - that suspended and deleted accounts are left alone.
 */
import { Test } from '@nestjs/testing';
import { NotificationType, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { InactivityProcessor } from './inactivity.processor';
import { INACTIVITY_NUDGE_DAYS } from './activity.constants';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('InactivityProcessor', () => {
  let processor: InactivityProcessor;
  let prisma: {
    user: { findMany: jest.Mock };
    notification: { count: jest.Mock };
  };
  let notify: jest.Mock;

  function givenUsers(users: Array<{ id: string; lastLoginAt: Date | null; createdAt?: Date }>) {
    // One page, then empty — the processor stops when a batch is short.
    prisma.user.findMany.mockResolvedValueOnce(
      users.map((u) => ({ createdAt: ago(400), ...u })),
    );
  }

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { count: jest.fn().mockResolvedValue(0) },
    };
    notify = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        InactivityProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { notify } },
      ],
    }).compile();

    processor = moduleRef.get(InactivityProcessor);
  });

  it('queries only ACTIVE candidate accounts', async () => {
    await processor.process({} as never);

    // Suspended accounts and purge tombstones must never be invited back.
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: UserRole.CANDIDATE,
          status: UserStatus.ACTIVE,
        }),
      }),
    );
  });

  it('includes never-logged-in accounts in the query rather than dropping them', async () => {
    await processor.process({} as never);

    // `lastLoginAt: { lt: cutoff }` alone would silently exclude every NULL,
    // which is the entire "signed up and vanished" cohort.
    const where = prisma.user.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([expect.objectContaining({ lastLoginAt: null })]),
    );
  });

  it('emails a candidate who has been gone longer than the window', async () => {
    givenUsers([{ id: 'u1', lastLoginAt: ago(INACTIVITY_NUDGE_DAYS + 5) }]);

    await expect(processor.process({} as never)).resolves.toEqual({ scanned: 1, notified: 1 });
    expect(notify).toHaveBeenCalledWith(
      'u1',
      NotificationType.CANDIDATE_INACTIVE_CHECK_IN,
      expect.objectContaining({ data: { inactiveDays: INACTIVITY_NUDGE_DAYS } }),
    );
  });

  it('does NOT email twice for the same spell of inactivity', async () => {
    givenUsers([{ id: 'u1', lastLoginAt: ago(60) }]);
    // Already asked, after they were last seen.
    prisma.notification.count.mockResolvedValue(1);

    await expect(processor.process({} as never)).resolves.toEqual({ scanned: 1, notified: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('asks AGAIN after they sign in and lapse a second time', async () => {
    // The guard counts only notifications dated after lastLoginAt, so a fresh
    // sign-in leaves the old nudge behind and re-arms the check. Simulated by
    // the count coming back 0 for the newer lastLoginAt.
    givenUsers([{ id: 'u1', lastLoginAt: ago(31) }]);
    prisma.notification.count.mockResolvedValue(0);

    await processor.process({} as never);

    expect(prisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          type: NotificationType.CANDIDATE_INACTIVE_CHECK_IN,
          createdAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('measures a never-logged-in account from SIGNUP, not from epoch', async () => {
    // Registered three days ago, never signed in again — still inside their
    // grace period, so asking "are you still looking?" would be absurd.
    givenUsers([{ id: 'fresh', lastLoginAt: null, createdAt: ago(3) }]);

    await expect(processor.process({} as never)).resolves.toEqual({ scanned: 1, notified: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('DOES ask a never-logged-in account once its signup is old enough', async () => {
    givenUsers([{ id: 'stale', lastLoginAt: null, createdAt: ago(45) }]);

    await expect(processor.process({} as never)).resolves.toEqual({ scanned: 1, notified: 1 });
  });

  it('keeps going when one recipient fails', async () => {
    givenUsers([
      { id: 'u1', lastLoginAt: ago(40) },
      { id: 'u2', lastLoginAt: ago(40) },
    ]);
    notify.mockRejectedValueOnce(new Error('smtp down'));

    // The second candidate must not be punished for the first one's failure.
    await expect(processor.process({} as never)).resolves.toEqual({ scanned: 2, notified: 1 });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

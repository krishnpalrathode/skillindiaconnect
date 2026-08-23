/**
 * The one-time "finish your profile" nudge.
 *
 * This sends a PAID WhatsApp message to a real phone, and it cannot be edited
 * or recalled once delivered. So what these test is not "does it send" but the
 * three ways it could send WRONGLY:
 *
 *  - to somebody who should not get it (too new, too old, already complete,
 *    suspended, already nudged);
 *  - twice;
 *  - with the wrong number in it — specifically a hardcoded 70 that has drifted
 *    from the setting the apply gate actually enforces.
 */
import { Test } from '@nestjs/testing';
import { NotificationType, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CompletionService } from './completion/completion.service';
import { ProfileNudgeProcessor, firstName } from './profile-nudge.processor';
import { PROFILE_NUDGE_DELAY_HOURS, PROFILE_NUDGE_MAX_AGE_DAYS } from './profile-nudge.constants';
import { WA_TEMPLATE_VARS_KEY } from '../notifications/notification.types';

const HOUR = 60 * 60 * 1000;

describe('ProfileNudgeProcessor', () => {
  let processor: ProfileNudgeProcessor;
  let prisma: { candidateProfile: { findMany: jest.Mock } };
  let notify: jest.Mock;
  let getMinCompletionPct: jest.Mock;

  /** One page, then empty — the processor stops when a batch is short. */
  function givenProfiles(
    profiles: Array<{ id: string; userId: string; fullName: string; completionPct: number }>,
  ) {
    prisma.candidateProfile.findMany.mockResolvedValueOnce(profiles);
  }

  beforeEach(async () => {
    prisma = { candidateProfile: { findMany: jest.fn().mockResolvedValue([]) } };
    notify = jest.fn().mockResolvedValue(undefined);
    getMinCompletionPct = jest.fn().mockResolvedValue(70);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfileNudgeProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { notify } },
        { provide: CompletionService, useValue: { getMinCompletionPct } },
      ],
    }).compile();

    processor = moduleRef.get(ProfileNudgeProcessor);
  });

  /** The single WHERE the scan is built from — the eligibility rule itself. */
  function whereClause() {
    return prisma.candidateProfile.findMany.mock.calls[0]![0].where;
  }

  describe('who is eligible — asserted on the query, because that IS the rule', () => {
    it('waits 24 hours before nudging anyone', async () => {
      const before = Date.now();
      await processor.process({} as never);
      const after = Date.now();

      const { lte } = whereClause().createdAt;
      // Profiles created more recently than 24h ago are excluded: the cutoff
      // sits 24h in the past, and only rows at or before it are considered.
      expect(lte.getTime()).toBeGreaterThanOrEqual(
        before - PROFILE_NUDGE_DELAY_HOURS * HOUR - 5_000,
      );
      expect(lte.getTime()).toBeLessThanOrEqual(after - PROFILE_NUDGE_DELAY_HOURS * HOUR + 5_000);
    });

    it('does not reach back further than the campaign window', async () => {
      // "You registered yesterday" copy must never land on a months-old
      // dormant account — that is a different campaign, honestly written.
      await processor.process({} as never);
      const { gte } = whereClause().createdAt;
      const expected = Date.now() - PROFILE_NUDGE_MAX_AGE_DAYS * 24 * HOUR;
      expect(Math.abs(gte.getTime() - expected)).toBeLessThan(5_000);
    });

    it('targets only profiles BELOW the live threshold', async () => {
      await processor.process({} as never);
      expect(whereClause().completionPct).toEqual({ lt: 70 });
    });

    it('reads the threshold from Settings — never a hardcoded 70', async () => {
      // An admin raising the bar to 80 must move this scan with it; otherwise
      // candidates at 75 are told they can apply when the gate refuses them.
      getMinCompletionPct.mockResolvedValue(80);
      await processor.process({} as never);
      expect(whereClause().completionPct).toEqual({ lt: 80 });
    });

    it('excludes anyone already nudged — ONCE, ever, enforced in SQL', async () => {
      /*
        Not "once per spell" like the inactivity check-in: once, full stop. The
        guard is a NOT EXISTS on the feed row the send itself writes, so an
        already-nudged candidate is never even fetched.
      */
      await processor.process({} as never);
      expect(whereClause().user.notifications).toEqual({
        none: { type: NotificationType.PROFILE_REMINDER },
      });
    });

    it('excludes suspended and deleted accounts', async () => {
      // A suspended account cannot apply for anything, so urging it to finish a
      // profile is a message with no honest ending.
      await processor.process({} as never);
      expect(whereClause().user).toMatchObject({
        role: UserRole.CANDIDATE,
        status: UserStatus.ACTIVE,
      });
    });
  });

  describe('the message itself', () => {
    it('carries the three template variables in the approved order', async () => {
      givenProfiles([
        { id: 'p1', userId: 'u1', fullName: 'Suresh Kumar Yadav', completionPct: 45 },
      ]);

      await processor.process({} as never);

      expect(notify).toHaveBeenCalledTimes(1);
      const [userId, type, payload] = notify.mock.calls[0]!;
      expect(userId).toBe('u1');
      expect(type).toBe(NotificationType.PROFILE_REMINDER);
      // {{1}} first name · {{2}} current % · {{3}} required %
      expect(payload.data[WA_TEMPLATE_VARS_KEY]).toEqual(['Suresh', '45', '70']);
    });

    it('tells the candidate the REAL required percentage when it changes', async () => {
      getMinCompletionPct.mockResolvedValue(80);
      givenProfiles([{ id: 'p1', userId: 'u1', fullName: 'Asha', completionPct: 45 }]);

      await processor.process({} as never);

      expect(notify.mock.calls[0]![2].data[WA_TEMPLATE_VARS_KEY]).toEqual(['Asha', '45', '80']);
    });

    it('greets by FIRST name only', () => {
      // "Hi Suresh" reads like a person wrote it; the full legal name reads
      // like a mail merge, which is what a nudge cannot afford to look like.
      expect(firstName('Suresh Kumar Yadav')).toBe('Suresh');
      expect(firstName('Asha')).toBe('Asha');
      expect(firstName('  Ravi   Patel ')).toBe('Ravi');
      // Never an empty greeting.
      expect(firstName('   ')).toBe('there');
    });
  });

  describe('robustness', () => {
    it('one failed recipient does not abort the sweep', async () => {
      // A single unreachable number must not cost everyone behind them in the
      // batch their nudge — and they are behind a once-ever guard, so a lost
      // send is lost for good.
      givenProfiles([
        { id: 'p1', userId: 'u1', fullName: 'A One', completionPct: 10 },
        { id: 'p2', userId: 'u2', fullName: 'B Two', completionPct: 20 },
      ]);
      notify.mockRejectedValueOnce(new Error('provider down'));

      const result = await processor.process({} as never);

      expect(notify).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ scanned: 2, notified: 1 });
    });

    it('sends nothing when nobody is eligible', async () => {
      const result = await processor.process({} as never);
      expect(notify).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, notified: 0 });
    });
  });
});

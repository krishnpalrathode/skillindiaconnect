import { NotificationType } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CompletionService } from './completion.service';
import { SETTING_KEY_MIN_COMPLETION_PCT } from './completion.constants';

/**
 * The "your profile is ready" confirmation.
 *
 * The behaviour worth pinning is that it fires ONCE. A candidate editing their
 * profile triggers a recompute on every save, and this notification sits
 * directly in that path — without the guard, adding a skill would email them
 * again, and again, and the one message meant to feel like an achievement would
 * become the reason they mute us.
 */
const THRESHOLD = 60;

function build(opts: { pct: number; alreadyNotified: number }) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const notificationCount = jest.fn().mockResolvedValue(opts.alreadyNotified);

  const prisma = {
    setting: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.key === SETTING_KEY_MIN_COMPLETION_PCT) return { value: THRESHOLD };
        return null;
      }),
    },
    notification: { count: notificationCount },
    candidateProfile: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'cand-1',
        userId: 'user-1',
        matchAlertSentAt: new Date(), // suppress the match-alert path
        photoKey: opts.pct >= THRESHOLD ? 'k' : null,
        fullName: 'Ravi',
        fatherName: opts.pct >= THRESHOLD ? 'Ram' : null,
        dob: opts.pct >= THRESHOLD ? new Date('1995-01-01') : null,
        phoneVerifiedAt: opts.pct >= THRESHOLD ? new Date() : null,
        maritalStatus: opts.pct >= THRESHOLD ? 'SINGLE' : null,
        languages: opts.pct >= THRESHOLD ? ['Hindi'] : [],
        jobCategoryId: opts.pct >= THRESHOLD ? 'cat' : null,
        currentLocation: opts.pct >= THRESHOLD ? 'Delhi' : null,
        nationality: opts.pct >= THRESHOLD ? 'Indian' : null,
        experiences:
          opts.pct >= THRESHOLD
            ? [{ type: 'LOCAL', country: 'India', companyName: 'A', role: 'B', years: 2 }]
            : [],
        skills: opts.pct >= THRESHOLD ? [{}, {}, {}] : [],
        documents: opts.pct >= THRESHOLD ? [{ type: 'PASSPORT' }] : [],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const service = new CompletionService(
    prisma as unknown as PrismaService,
    { add: jest.fn() } as unknown as Queue,
    { notify } as never,
  );
  return { service, notify, notificationCount };
}

describe('profile-complete confirmation', () => {
  it('notifies when the profile crosses the apply threshold', async () => {
    const { service, notify } = build({ pct: 100, alreadyNotified: 0 });
    await service.recomputeForCandidate('cand-1');
    expect(notify).toHaveBeenCalledWith(
      'user-1',
      NotificationType.CANDIDATE_PROFILE_COMPLETE,
      expect.objectContaining({ title: expect.stringMatching(/ready/i) }),
    );
  });

  it('does NOT notify a second time — every profile edit re-runs this path', async () => {
    const { service, notify } = build({ pct: 100, alreadyNotified: 1 });
    await service.recomputeForCandidate('cand-1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('stays silent below the threshold', async () => {
    const { service, notify } = build({ pct: 0, alreadyNotified: 0 });
    await service.recomputeForCandidate('cand-1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a notification failure does not fail the profile save', async () => {
    // The save is the user's actual request; the confirmation is a courtesy.
    const { service, notify } = build({ pct: 100, alreadyNotified: 0 });
    notify.mockRejectedValueOnce(new Error('queue down'));
    await expect(service.recomputeForCandidate('cand-1')).resolves.toEqual(
      expect.objectContaining({ pct: expect.any(Number) }),
    );
  });
});

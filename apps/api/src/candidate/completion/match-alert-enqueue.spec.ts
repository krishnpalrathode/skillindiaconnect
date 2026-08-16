/**
 * The API-process half of the match alert: recompute decides whether to ENQUEUE.
 *
 * The rule being protected here is worker-and-external-sends.md — the API writes
 * state and enqueues; it must never match or send inline. These tests assert on
 * the queue interaction, which is the only thing this side is allowed to do.
 */
import type { Queue } from 'bullmq';
import { CompletionService } from './completion.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { JOB_NAMES } from '../../queue/queue.constants';
import { SETTING_KEY_MATCH_ALERT_MIN_PCT } from './completion.constants';

/**
 * A profile that scores 100%: all ten personal-info fields, both experience
 * kinds, every mandatory doc, three skills. Individual field weights are
 * completion.service.spec.ts's business — here we only need to land above or
 * below a threshold on demand.
 */
function fullProfile(over: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    photoKey: 'k',
    fullName: 'Rajan Patel',
    fatherName: 'Suresh Patel',
    dob: new Date('1990-01-01'),
    phoneVerifiedAt: new Date(),
    maritalStatus: 'SINGLE',
    languages: ['hi', 'en'],
    jobCategoryId: 'cat-1',
    currentLocation: 'Mumbai',
    nationality: 'Indian',
    matchAlertSentAt: null,
    experiences: [
      {
        type: 'FOREIGN',
        country: 'UAE',
        companyName: 'A',
        role: 'Electrician',
        years: 5,
        months: 0,
      },
    ],
    skills: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    documents: [{ type: 'PASSPORT' }, { type: 'EXPERIENCE_CERT' }, { type: 'EDUCATIONAL_CERT' }],
    ...over,
  };
}

function build(profile: Record<string, unknown>, threshold: number | undefined = 80) {
  const add = jest.fn().mockResolvedValue({});
  const prisma = {
    candidateProfile: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({}),
    },
    setting: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
        if (where.key === SETTING_KEY_MATCH_ALERT_MIN_PCT) {
          return Promise.resolve(threshold === undefined ? null : { value: threshold });
        }
        // Mandatory-doc count: the seeded three-element array.
        return Promise.resolve({ value: ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'] });
      }),
    },
  };

  const service = new CompletionService(
    prisma as unknown as PrismaService,
    { add } as unknown as Queue,
    // Notification is a separate side effect; this suite is about the queue.
    { notify: jest.fn() } as never,
  );
  return { service, add, prisma };
}

describe('CompletionService — match-alert enqueue', () => {
  it('enqueues once the profile reaches the threshold', async () => {
    const { service, add } = build(fullProfile());

    const result = await service.recomputeForCandidate('cand-1');

    expect(result.pct).toBeGreaterThanOrEqual(80);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.SEND_MATCH_ALERT,
      { candidateId: 'cand-1' },
      // Deterministic jobId — profile edits fire recompute repeatedly and every
      // one of them would otherwise enqueue another copy (cron-queue-dedupe.md).
      { jobId: 'match-alert-cand-1' },
    );
  });

  it('builds a jobId BullMQ will actually accept', async () => {
    // Regression guard. A stubbed queue accepts any string, so the original
    // `match-alert:${id}` passed its unit test and then threw "Custom Id cannot
    // contain :" against the real library on the first live enqueue.
    const { service, add } = build(fullProfile());

    await service.recomputeForCandidate('cand-1');

    const jobId = (add.mock.calls[0]![2] as { jobId: string }).jobId;
    expect(jobId).not.toContain(':');
  });

  it('does not enqueue below the threshold', async () => {
    // Strip the documents block (30 points) and the skills (10) → well under 80.
    const { service, add } = build(fullProfile({ documents: [], skills: [] }));

    const result = await service.recomputeForCandidate('cand-1');

    expect(result.pct).toBeLessThan(80);
    expect(add).not.toHaveBeenCalled();
  });

  it('does not enqueue when the alert has already been sent', async () => {
    const { service, add } = build(fullProfile({ matchAlertSentAt: new Date('2026-01-01') }));

    await service.recomputeForCandidate('cand-1');

    expect(add).not.toHaveBeenCalled();
  });

  it('honours a Settings threshold above the default', async () => {
    const { service, add } = build(fullProfile(), 101); // unreachable

    await service.recomputeForCandidate('cand-1');

    expect(add).not.toHaveBeenCalled();
  });

  it('falls back to the default threshold when the setting row is missing', async () => {
    const { service, add } = build(fullProfile(), undefined);

    await service.recomputeForCandidate('cand-1');

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('a queue outage does not fail the profile save', async () => {
    const { prisma } = build(fullProfile());
    const failing = new CompletionService(
      prisma as unknown as PrismaService,
      { add: jest.fn().mockRejectedValue(new Error('redis down')) } as unknown as Queue,
      { notify: jest.fn() } as never,
    );

    // The completion write is the user's actual request; the alert is a nicety.
    await expect(failing.recomputeForCandidate('cand-1')).resolves.toEqual(
      expect.objectContaining({ pct: expect.any(Number) }),
    );
    expect(prisma.candidateProfile.update).toHaveBeenCalled();
  });
});

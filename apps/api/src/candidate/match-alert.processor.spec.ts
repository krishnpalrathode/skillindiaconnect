/**
 * Unit tests for the profile-completion job-match alert.
 *
 * Deliberately container-free: every collaborator is a stub, so these assert the
 * DECISIONS (fire-once, threshold, top-3, who is skipped) rather than SQL. The
 * scoring engine itself is already covered by match.compute.spec.ts.
 */
import { JobMarket, NotificationType, UserStatus } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { MatchAlertProcessor, type MatchAlertJobData } from './match-alert.processor';
import { JOB_NAMES } from '../queue/queue.constants';
import { MatchService } from '../applications/match/match.service';
import type { JobForMatching } from '../jobs/jobs-match-read.service';

const CANDIDATE_ID = 'cand-1';
const USER_ID = 'user-1';

function mkJob(id: string, title: string, opts: Partial<JobForMatching> = {}): JobForMatching {
  return {
    id,
    title,
    market: JobMarket.GULF,
    categoryId: 'cat-1',
    experienceRequiredYears: 2,
    location: 'Dubai',
    companyName: 'Gulf Star',
    ...opts,
  };
}

function mkProfile(over: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    userId: USER_ID,
    fullName: 'Rajan Kumar Patel',
    completionPct: 85,
    matchAlertSentAt: null,
    jobCategoryId: 'cat-1',
    experiences: [{ type: 'FOREIGN', years: 5, months: 0 }],
    documents: [{ type: 'PASSPORT' }, { type: 'EXPERIENCE_CERT' }, { type: 'EDUCATIONAL_CERT' }],
    jobCategory: { slug: 'electrical' },
    user: { status: UserStatus.ACTIVE },
    ...over,
  };
}

function build(opts: {
  profile: ReturnType<typeof mkProfile> | null;
  jobs?: JobForMatching[];
  threshold?: number;
}) {
  const update = jest.fn().mockResolvedValue({});
  const notify = jest.fn().mockResolvedValue(undefined);

  const prisma = {
    candidateProfile: {
      findUnique: jest.fn().mockResolvedValue(opts.profile),
      update,
    },
  };
  const notificationService = { notify };
  const jobsRead = {
    getActiveJobsForMatching: jest.fn().mockResolvedValue(opts.jobs ?? []),
  };
  const completionService = {
    getMatchAlertMinPct: jest.fn().mockResolvedValue(opts.threshold ?? 80),
    getMandatoryDocCount: jest.fn().mockResolvedValue(3),
  };
  const config = { get: jest.fn().mockReturnValue('https://app.example.com') };

  const processor = new MatchAlertProcessor(
    prisma as never,
    notificationService as never,
    jobsRead as never,
    new MatchService(),
    completionService as never,
    config as never,
  );

  return { processor, update, notify, jobsRead };
}

const bullJob = (data: MatchAlertJobData = { candidateId: CANDIDATE_ID }) =>
  ({ name: JOB_NAMES.SEND_MATCH_ALERT, data, id: '1' }) as BullJob<MatchAlertJobData>;

describe('MatchAlertProcessor', () => {
  it('sends the alert and stamps the fire-once guard', async () => {
    const { processor, update, notify } = build({
      profile: mkProfile(),
      jobs: [mkJob('j1', 'Electrician'), mkJob('j2', 'Senior Electrician')],
    });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: true, jobCount: 2 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe(USER_ID);
    expect(notify.mock.calls[0]![1]).toBe(NotificationType.NEW_JOB_MATCH);
    // The guard is stamped so a later recompute cannot re-send.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CANDIDATE_ID },
        data: expect.objectContaining({ matchAlertSentAt: expect.any(Date) }),
      }),
    );
  });

  it('sends at most three jobs, highest score first', async () => {
    // Five candidates for three slots. The two LOCAL jobs score lower for a
    // candidate whose experience is FOREIGN, so they must be the ones dropped.
    const { processor, notify } = build({
      profile: mkProfile(),
      jobs: [
        mkJob('j1', 'Local A', { market: JobMarket.LOCAL }),
        mkJob('j2', 'Gulf A'),
        mkJob('j3', 'Local B', { market: JobMarket.LOCAL }),
        mkJob('j4', 'Gulf B'),
        mkJob('j5', 'Gulf C'),
      ],
    });

    const result = await processor.process(bullJob());

    expect(result.jobCount).toBe(3);
    const sentIds = notify.mock.calls[0]![2].data.jobIds as string[];
    expect(sentIds).toHaveLength(3);
    expect(sentIds).toEqual(['j2', 'j4', 'j5']);
  });

  it('carries WhatsApp templateVars even though the channel is still off', async () => {
    // The producer must supply these NOW, so enabling WhatsApp later is a
    // one-line matrix change and not a silent send with holes in it.
    const { processor, notify } = build({
      profile: mkProfile(),
      jobs: [mkJob('j1', 'Electrician')],
    });

    await processor.process(bullJob());

    const vars = notify.mock.calls[0]![2].data.templateVars as string[];
    expect(vars).toHaveLength(3);
    expect(vars[0]).toBe('Rajan'); // first name only
    expect(vars[1]).toContain('Electrician');
    expect(vars[2]).toBe('https://app.example.com/jobs?category=electrical');
  });

  it('does nothing when the guard is already set', async () => {
    const { processor, update, notify } = build({
      profile: mkProfile({ matchAlertSentAt: new Date('2026-01-01') }),
      jobs: [mkJob('j1', 'Electrician')],
    });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'already-sent' });
    expect(notify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing when completion dropped below the threshold since enqueue', async () => {
    const { processor, notify } = build({
      profile: mkProfile({ completionPct: 79 }),
      jobs: [mkJob('j1', 'Electrician')],
    });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'below-threshold' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('respects a threshold an admin raised while the job sat in the queue', async () => {
    const { processor, notify } = build({
      profile: mkProfile({ completionPct: 85 }),
      jobs: [mkJob('j1', 'Electrician')],
      threshold: 90,
    });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'below-threshold' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('never messages a non-ACTIVE user', async () => {
    const { processor, notify } = build({
      profile: mkProfile({ user: { status: UserStatus.SUSPENDED } }),
      jobs: [mkJob('j1', 'Electrician')],
    });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'inactive-user' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('with no matching jobs, sends nothing AND leaves the guard unset so a later run can alert', async () => {
    const { processor, update, notify } = build({ profile: mkProfile(), jobs: [] });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'no-matches' });
    expect(notify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns quietly for a candidate that no longer exists', async () => {
    const { processor, notify } = build({ profile: null });

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'no-profile' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores a job with an unexpected name', async () => {
    const { processor, notify } = build({ profile: mkProfile() });

    const result = await processor.process({
      name: 'something-else',
      data: { candidateId: CANDIDATE_ID },
    } as BullJob<MatchAlertJobData>);

    expect(result).toEqual({ sent: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it('links to the unfiltered jobs list when the candidate has no category', async () => {
    const { processor, notify } = build({
      profile: mkProfile({ jobCategoryId: null, jobCategory: null }),
      jobs: [mkJob('j1', 'Electrician')],
    });

    await processor.process(bullJob());

    expect(notify.mock.calls[0]![2].data.link).toBe('https://app.example.com/jobs');
  });
});

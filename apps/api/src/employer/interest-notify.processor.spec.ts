/**
 * Unit tests for employer → candidate outreach.
 *
 * The rules worth protecting are all refusals: message once, never to a
 * withdrawn interest, never from a suspended company, never to a hidden or
 * suspended candidate. Container-free — every collaborator is a stub.
 */
import { CompanyStatus, NotificationType, UserStatus } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { InterestNotifyProcessor, type InterestNotifyJobData } from './interest-notify.processor';
import { JOB_NAMES } from '../queue/queue.constants';

const COMPANY_ID = 'co-1';
const CANDIDATE_ID = 'cand-1';
const USER_ID = 'user-1';

function mkInterest(over: Record<string, unknown> = {}) {
  return {
    notifiedAt: null,
    company: { name: 'Gulf Star Contracting LLC', status: CompanyStatus.APPROVED },
    candidate: {
      userId: USER_ID,
      fullName: 'Rajan Kumar Patel',
      profileVisible: true,
      user: { status: UserStatus.ACTIVE },
    },
    ...over,
  };
}

function build(interest: ReturnType<typeof mkInterest> | null) {
  const update = jest.fn().mockResolvedValue({});
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    candidateInterest: {
      findUnique: jest.fn().mockResolvedValue(interest),
      update,
    },
  };
  const processor = new InterestNotifyProcessor(prisma as never, { notify } as never);
  return { processor, update, notify };
}

const bullJob = () =>
  ({
    name: JOB_NAMES.SEND_INTEREST_NOTICE,
    data: { companyId: COMPANY_ID, candidateId: CANDIDATE_ID },
    id: '1',
  }) as BullJob<InterestNotifyJobData>;

describe('InterestNotifyProcessor', () => {
  it('notifies the candidate and stamps the once-per-employer guard', async () => {
    const { processor, update, notify } = build(mkInterest());

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe(USER_ID);
    expect(notify.mock.calls[0]![1]).toBe(NotificationType.EMPLOYER_INTERESTED);
    expect(notify.mock.calls[0]![2].body).toContain('Gulf Star Contracting LLC');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notifiedAt: expect.any(Date) }) }),
    );
  });

  it('carries WhatsApp templateVars in template order', async () => {
    const { processor, notify } = build(mkInterest());

    await processor.process(bullJob());

    const vars = notify.mock.calls[0]![2].data.templateVars as string[];
    expect(vars).toEqual(['Rajan', 'Gulf Star Contracting LLC']);
  });

  it('refuses to message the same candidate twice', async () => {
    const { processor, update, notify } = build(mkInterest({ notifiedAt: new Date('2026-01-01') }));

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'already-notified' });
    expect(notify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('says nothing when the employer un-marked between enqueue and send', async () => {
    const { processor, notify } = build(null);

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'no-interest-row' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('blocks a company suspended after queuing', async () => {
    const { processor, notify } = build(
      mkInterest({ company: { name: 'Bad Co', status: CompanyStatus.SUSPENDED } }),
    );

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'company-not-approved' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not message a candidate who has hidden their profile', async () => {
    const { processor, notify } = build(
      mkInterest({
        candidate: {
          userId: USER_ID,
          fullName: 'Rajan',
          profileVisible: false,
          user: { status: UserStatus.ACTIVE },
        },
      }),
    );

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'candidate-unavailable' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not message a suspended candidate', async () => {
    const { processor, notify } = build(
      mkInterest({
        candidate: {
          userId: USER_ID,
          fullName: 'Rajan',
          profileVisible: true,
          user: { status: UserStatus.SUSPENDED },
        },
      }),
    );

    const result = await processor.process(bullJob());

    expect(result).toEqual({ sent: false, reason: 'candidate-unavailable' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores an unexpected job name', async () => {
    const { processor, notify } = build(mkInterest());

    const result = await processor.process({
      name: 'other',
      data: { companyId: COMPANY_ID, candidateId: CANDIDATE_ID },
    } as BullJob<InterestNotifyJobData>);

    expect(result).toEqual({ sent: false });
    expect(notify).not.toHaveBeenCalled();
  });
});

/**
 * The nudge cron — it must enqueue, and nothing else.
 *
 * The jobId is the load-bearing part. It is what stops a second worker replica
 * sending every candidate a second WhatsApp, and BullMQ 5 rejects a custom
 * jobId containing ':' at RUNTIME — a stubbed queue in a unit test accepts one
 * happily, so that trap only surfaces on the first real enqueue.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { ProfileNudgeCron } from './profile-nudge.cron';

describe('ProfileNudgeCron', () => {
  let cron: ProfileNudgeCron;
  let add: jest.Mock;

  beforeEach(async () => {
    add = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfileNudgeCron,
        { provide: getQueueToken(QUEUE_NAMES.PROFILE_NUDGE), useValue: { add } },
      ],
    }).compile();
    cron = moduleRef.get(ProfileNudgeCron);
  });

  it('enqueues the scan and does no work itself', async () => {
    await cron.scheduleProfileNudgeScan();

    expect(add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = add.mock.calls[0]!;
    expect(name).toBe(JOB_NAMES.PROFILE_NUDGE_SCAN);
    expect(payload).toEqual({});
    expect(opts.jobId).toBeTruthy();
  });

  it('uses a jobId with NO colon — BullMQ 5 rejects those at runtime', () => {
    /*
      The hour slice comes from an ISO timestamp, which carries a 'T' and would
      carry ':' if the slice were any wider. Getting this wrong does not fail a
      unit test: it throws on the first real enqueue, and any producer that
      swallows enqueue errors hides it completely — the scan simply never runs.
    */
    return cron.scheduleProfileNudgeScan().then(() => {
      const { jobId } = add.mock.calls[0]![2];
      expect(jobId).not.toContain(':');
      expect(jobId).toMatch(/^profile-nudge-scan-\d{4}-\d{2}-\d{2}-\d{2}$/);
    });
  });

  it('collapses duplicate fires within the same hour to ONE job', async () => {
    // Two replicas firing the same hour must produce one scan, not two — the
    // difference is every candidate receiving a second paid WhatsApp.
    await cron.scheduleProfileNudgeScan();
    await cron.scheduleProfileNudgeScan();

    const [first, second] = add.mock.calls.map((c) => c[2].jobId);
    expect(first).toBe(second);
  });
});

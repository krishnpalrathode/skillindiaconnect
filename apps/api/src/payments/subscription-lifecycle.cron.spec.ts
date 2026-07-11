/**
 * The standing cron-queue-dedupe assertions (third consumer of the pattern):
 * the handler ONLY enqueues — deterministic day-derived jobId, no DB access,
 * no sends. The ladder lives in the processor, not here.
 */
import { Queue } from 'bullmq';
import { JOB_NAMES } from '../queue/queue.constants';
import { SubscriptionLifecycleCron } from './subscription-lifecycle.cron';

describe('SubscriptionLifecycleCron', () => {
  let queue: { add: jest.Mock };
  let cron: SubscriptionLifecycleCron;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    cron = new SubscriptionLifecycleCron(queue as unknown as Queue);
  });

  it('enqueues exactly one sweep job with a deterministic day-derived jobId', async () => {
    await cron.scheduleSubscriptionLifecycleSweep();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = queue.add.mock.calls[0] as [
      string,
      unknown,
      { jobId: string },
    ];
    expect(name).toBe(JOB_NAMES.SUBSCRIPTION_LIFECYCLE_SWEEP);
    expect(payload).toEqual({});

    const day = new Date().toISOString().slice(0, 10);
    expect(opts.jobId).toBe(`subscription-lifecycle-${day}`);
  });

  it('jobId never contains ":" (BullMQ v5 rejects it — the sweep would silently never enqueue)', async () => {
    await cron.scheduleSubscriptionLifecycleSweep();
    const [, , opts] = queue.add.mock.calls[0] as [string, unknown, { jobId: string }];
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toMatch(/^subscription-lifecycle-\d{4}-\d{2}-\d{2}$/);
  });

  it('same day → same jobId (BullMQ dedupe makes multi-replica firing exactly-once)', async () => {
    await cron.scheduleSubscriptionLifecycleSweep();
    await cron.scheduleSubscriptionLifecycleSweep();
    const [, , first] = queue.add.mock.calls[0] as [string, unknown, { jobId: string }];
    const [, , second] = queue.add.mock.calls[1] as [string, unknown, { jobId: string }];
    expect(first.jobId).toBe(second.jobId);
  });

  it('enqueue-only: the handler touches nothing but the queue (no Prisma, no services injected)', () => {
    // The constructor accepts ONLY the queue — there is structurally nothing
    // else the @Cron handler could call inline. Guards against a future dep
    // sneaking DB work into the cron path.
    expect(SubscriptionLifecycleCron.length).toBe(1);
  });
});

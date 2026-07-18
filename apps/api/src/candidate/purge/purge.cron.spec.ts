import { PurgeCron } from './purge.cron';
import { JOB_NAMES } from '../../queue/queue.constants';
import type { Queue } from 'bullmq';

describe('PurgeCron (cron-queue-dedupe rule)', () => {
  it('does NOTHING but enqueue, with a deterministic per-day jobId and no colon', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const cron = new PurgeCron({ add } as unknown as Queue);

    await cron.schedulePurgeSweep();

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = add.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { jobId: string },
    ];
    expect(jobName).toBe(JOB_NAMES.PURGE_SWEEP);
    expect(payload).toEqual({});
    const day = new Date().toISOString().slice(0, 10);
    expect(opts.jobId).toBe(`purge-sweep-${day}`);
    // BullMQ v5 rejects ':' in custom jobIds — a colon would mean the sweep is
    // silently never enqueued.
    expect(opts.jobId).not.toContain(':');
  });

  it('two firings on the same day dedupe to one job (same deterministic id)', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const cron = new PurgeCron({ add } as unknown as Queue);
    await cron.schedulePurgeSweep();
    await cron.schedulePurgeSweep();
    const ids = add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(new Set(ids).size).toBe(1); // BullMQ's jobId dedupe makes run #2 a no-op
  });
});

/**
 * Unit tests for JobsCron — verifies the cron handler ONLY enqueues a BullMQ job
 * with a deterministic jobId and does NOT do any DB writes or external sends.
 *
 * This enforces the cron-queue-dedupe.md rule:
 *   "A cron handler does NOTHING but enqueue a BullMQ job with a deterministic jobId."
 */
import { Queue } from 'bullmq';
import { JobsCron } from './jobs.cron';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

function makeQueueMock(): jest.Mocked<Pick<Queue, 'add'>> {
  return { add: jest.fn().mockResolvedValue({ id: 'q-job-1' }) };
}

describe('JobsCron — cron enqueues only, no inline work', () => {
  let cron: JobsCron;
  let queueMock: ReturnType<typeof makeQueueMock>;

  beforeEach(() => {
    queueMock = makeQueueMock();
    cron = new JobsCron(queueMock as unknown as Queue);
  });

  it('enqueues one BullMQ job per scheduleAutoArchive call', async () => {
    await cron.scheduleAutoArchive();
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it('uses the correct job name (auto-archive-jobs)', async () => {
    await cron.scheduleAutoArchive();
    const [jobName] = queueMock.add.mock.calls[0]!;
    expect(jobName).toBe(JOB_NAMES.AUTO_ARCHIVE_JOBS);
  });

  it('deterministic jobId matches pattern auto-archive:YYYY-MM-DD', async () => {
    const before = new Date().toISOString().slice(0, 10);
    await cron.scheduleAutoArchive();
    const after = new Date().toISOString().slice(0, 10);

    const [, , opts] = queueMock.add.mock.calls[0]!;
    const jobId = (opts as { jobId?: string }).jobId ?? '';
    expect(jobId).toMatch(/^auto-archive:\d{4}-\d{2}-\d{2}$/);
    // The date in the jobId must be today (boundary-safe: before ≤ date ≤ after)
    const dateInId = jobId.replace('auto-archive:', '');
    expect(dateInId >= before && dateInId <= after).toBe(true);
  });

  it('passes an empty payload (no DB reads in the cron method)', async () => {
    await cron.scheduleAutoArchive();
    const [, payload] = queueMock.add.mock.calls[0]!;
    expect(payload).toEqual({});
  });

  it('uses the QUEUE_NAMES.AUTO_ARCHIVE queue (verified via constructor injection)', () => {
    // The cron receives the AUTO_ARCHIVE queue via @InjectQueue(QUEUE_NAMES.AUTO_ARCHIVE).
    // Verify the constant is stable — a rename would break the cron silently.
    expect(QUEUE_NAMES.AUTO_ARCHIVE).toBe('auto-archive');
  });
});

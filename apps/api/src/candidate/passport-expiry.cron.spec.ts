/**
 * PassportExpiryCron unit tests.
 *
 * Rule (cron-queue-dedupe.md): the @Cron handler does NOTHING but enqueue a
 * BullMQ job with a deterministic jobId. These tests verify:
 *   1. Exactly one queue.add() call per invocation.
 *   2. jobId is deterministic and date-derived (`passport-expiry:YYYY-MM-DD`).
 *   3. Job name is JOB_NAMES.PASSPORT_EXPIRY_SCAN.
 *   4. No DB access happens inline (queue mock never touches Prisma).
 */

import { PassportExpiryCron } from './passport-expiry.cron';
import { JOB_NAMES } from '../queue/queue.constants';

describe('PassportExpiryCron', () => {
  let cron: PassportExpiryCron;
  let mockQueue: { add: jest.Mock };

  beforeEach(() => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'bullmq-job-id' }) };
    cron = new PassportExpiryCron(mockQueue as any);
  });

  it('enqueues exactly one job per invocation', async () => {
    await cron.schedulePassportExpiryReminders();
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
  });

  it('job name is PASSPORT_EXPIRY_SCAN', async () => {
    await cron.schedulePassportExpiryReminders();
    const [name] = mockQueue.add.mock.calls[0]!;
    expect(name).toBe(JOB_NAMES.PASSPORT_EXPIRY_SCAN);
  });

  it('jobId is deterministic and follows passport-expiry:YYYY-MM-DD pattern', async () => {
    await cron.schedulePassportExpiryReminders();
    const [, , opts] = mockQueue.add.mock.calls[0]!;
    const today = new Date().toISOString().slice(0, 10);
    expect(opts.jobId).toBe(`passport-expiry:${today}`);
  });

  it('same-day second call produces identical jobId (BullMQ dedupe)', async () => {
    await cron.schedulePassportExpiryReminders();
    await cron.schedulePassportExpiryReminders();
    const jobId1 = mockQueue.add.mock.calls[0]![2]!.jobId as string;
    const jobId2 = mockQueue.add.mock.calls[1]![2]!.jobId as string;
    expect(jobId1).toBe(jobId2);
  });

  it('passes an empty payload object (all config is in the jobId + processor)', async () => {
    await cron.schedulePassportExpiryReminders();
    const [, payload] = mockQueue.add.mock.calls[0]!;
    expect(payload).toEqual({});
  });
});

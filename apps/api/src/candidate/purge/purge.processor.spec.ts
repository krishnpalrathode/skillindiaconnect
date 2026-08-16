import { UserRole, UserStatus } from '@prisma/client';
import { Job as BullJob, Queue } from 'bullmq';
import { PurgeProcessor, type PurgeJobData } from './purge.processor';
import { PurgeService } from './purge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JOB_NAMES } from '../../queue/queue.constants';

describe('PurgeProcessor', () => {
  const makeProcessor = (overrides?: { dueUsers?: { id: string }[]; captureKeys?: string[] }) => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(overrides?.dueUsers ?? []) },
    } as unknown as PrismaService;
    const purgeService = {
      captureObjectKeys: jest.fn().mockResolvedValue(overrides?.captureKeys ?? ['k1', 'k2']),
      purgeUser: jest.fn().mockResolvedValue({ outcome: 'purged', counts: {} }),
    } as unknown as jest.Mocked<PurgeService>;
    const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;
    return {
      processor: new PurgeProcessor(prisma, purgeService, queue),
      prisma,
      purgeService,
      queue,
    };
  };

  const makeJob = (name: string, data: PurgeJobData): BullJob<PurgeJobData> =>
    ({
      name,
      data,
      updateData: jest.fn(async function (this: { data: PurgeJobData }, next: PurgeJobData) {
        (this as { data: PurgeJobData }).data = next;
      }),
    }) as unknown as BullJob<PurgeJobData>;

  describe('the sweep', () => {
    it('queries due PENDING_DELETION candidates and ENQUEUES only — per-day, colon-free ids', async () => {
      const { processor, prisma, purgeService, queue } = makeProcessor({
        dueUsers: [{ id: 'user-a' }, { id: 'user-b' }],
      });

      const result = await processor.process(makeJob(JOB_NAMES.PURGE_SWEEP, {} as PurgeJobData));

      expect(result).toEqual({ enqueued: 2 });
      // The sweep NEVER purges inline.
      expect(purgeService.purgeUser).not.toHaveBeenCalled();

      const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.role).toBe(UserRole.CANDIDATE);
      expect(where.status).toBe(UserStatus.PENDING_DELETION);
      expect(where.purgedAt).toBeNull();

      const day = new Date().toISOString().slice(0, 10);
      const calls = (queue.add as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      // Per-day suffix: NOT `purge-{userId}` — S1-3's immediate job already
      // holds that id (completed-as-skip), and BullMQ's dedupe would swallow a
      // re-add, stranding the user unpurged forever.
      expect(calls[0][2].jobId).toBe(`purge-user-a-due-${day}`);
      expect(calls[1][2].jobId).toBe(`purge-user-b-due-${day}`);
      for (const call of calls) {
        expect(call[0]).toBe(JOB_NAMES.PURGE_CANDIDATE);
        expect(call[2].jobId).not.toContain(':');
        expect(call[2].attempts).toBeGreaterThan(1); // retries are the resumability story
      }
    });
  });

  describe('a per-user purge job', () => {
    it('captures R2 keys and PERSISTS them into the job BEFORE the destructive call', async () => {
      const { processor, purgeService } = makeProcessor({ captureKeys: ['docs/p.pdf'] });
      const job = makeJob(JOB_NAMES.PURGE_CANDIDATE, { userId: 'user-a', trigger: 'self' });

      await processor.process(job);

      // updateData ran before purgeUser, and purgeUser received the same keys.
      expect(job.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ capturedKeys: ['docs/p.pdf'] }),
      );
      const input = (purgeService.purgeUser as jest.Mock).mock.calls[0][0];
      expect(input.capturedKeys).toEqual(['docs/p.pdf']);
      const captureOrder = (purgeService.captureObjectKeys as jest.Mock).mock
        .invocationCallOrder[0]!;
      const purgeOrder = (purgeService.purgeUser as jest.Mock).mock.invocationCallOrder[0]!;
      expect(captureOrder).toBeLessThan(purgeOrder);
    });

    it('a RETRY reuses the persisted keys instead of re-capturing (the DB no longer knows them)', async () => {
      const { processor, purgeService } = makeProcessor();
      const job = makeJob(JOB_NAMES.PURGE_CANDIDATE, {
        userId: 'user-a',
        trigger: 'self',
        capturedKeys: ['kept/from/attempt-1.pdf'],
        counts: { objectsDestroyed: 0 } as PurgeJobData['counts'],
      });

      await processor.process(job);

      expect(purgeService.captureObjectKeys).not.toHaveBeenCalled();
      const input = (purgeService.purgeUser as jest.Mock).mock.calls[0][0];
      expect(input.capturedKeys).toEqual(['kept/from/attempt-1.pdf']);
      expect(input.priorCounts).toEqual({ objectsDestroyed: 0 });
    });

    it('passes the admin trigger context through to the service', async () => {
      const { processor, purgeService } = makeProcessor();
      const job = makeJob(JOB_NAMES.PURGE_CANDIDATE, {
        userId: 'user-a',
        trigger: 'admin',
        reason: 'DPDP erasure request #123',
        actorUserId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
      });
      await processor.process(job);
      const input = (purgeService.purgeUser as jest.Mock).mock.calls[0][0];
      expect(input.trigger).toBe('admin');
      expect(input.reason).toBe('DPDP erasure request #123');
      expect(input.actorUserId).toBe('admin-1');
    });

    it('an unknown job name is skipped, never purged', async () => {
      const { processor, purgeService } = makeProcessor();
      await processor.process(makeJob('mystery-job', { userId: 'user-a' }));
      expect(purgeService.purgeUser).not.toHaveBeenCalled();
    });
  });
});

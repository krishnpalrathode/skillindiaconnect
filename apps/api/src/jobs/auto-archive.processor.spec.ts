/**
 * Unit tests for AutoArchiveProcessor — verifies:
 * - process() calls batchAutoArchive() and logs the count.
 * - Errors from batchAutoArchive propagate (BullMQ will retry).
 */
import { Job as BullJob } from 'bullmq';
import { AutoArchiveProcessor } from './auto-archive.processor';
import { JobLifecycleService } from './job-lifecycle.service';
import { JOB_NAMES } from '../queue/queue.constants';

function makeLifecycleMock(): jest.Mocked<Pick<JobLifecycleService, 'batchAutoArchive'>> {
  return {
    batchAutoArchive: jest.fn().mockResolvedValue(5),
  };
}

function makeBullJob(id = 'bj-1'): BullJob {
  return { id, name: JOB_NAMES.AUTO_ARCHIVE_JOBS } as unknown as BullJob;
}

describe('AutoArchiveProcessor', () => {
  let processor: AutoArchiveProcessor;
  let lifecycleMock: ReturnType<typeof makeLifecycleMock>;

  beforeEach(() => {
    lifecycleMock = makeLifecycleMock();
    processor = new AutoArchiveProcessor(
      lifecycleMock as unknown as JobLifecycleService,
    );
  });

  it('calls batchAutoArchive and resolves without error', async () => {
    await processor.process(makeBullJob());
    expect(lifecycleMock.batchAutoArchive).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from batchAutoArchive so BullMQ retries the job', async () => {
    lifecycleMock.batchAutoArchive.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(processor.process(makeBullJob())).rejects.toThrow('DB connection lost');
  });

  it('handles 0-archive result without error', async () => {
    lifecycleMock.batchAutoArchive.mockResolvedValueOnce(0);
    await expect(processor.process(makeBullJob())).resolves.toEqual({ archivedCount: 0 });
  });
});

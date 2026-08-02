/**
 * R2DeleteProcessor — the consumer the R2_DELETE queue never had.
 *
 * The property under test is not "it calls deleteObject". It is that this
 * processor NEVER reports a deletion that did not happen: a candidate who
 * deletes a passport scan is entitled to have the bytes destroyed, and until
 * now the job was enqueued and silently never consumed.
 */
import { Job as BullJob } from 'bullmq';
import { R2DeleteProcessor, type R2DeleteJobData } from './r2-delete.processor';
import { StorageService } from './storage.service';
import { JOB_NAMES } from '../../queue/queue.constants';

function makeStorageMock() {
  return { deleteObject: jest.fn().mockResolvedValue(undefined) };
}

function makeJob(
  data: Partial<R2DeleteJobData> = {},
  name: string = JOB_NAMES.DELETE_OBJECT,
): BullJob<R2DeleteJobData> {
  return {
    id: 'r2del-1',
    name,
    data: { key: 'candidates/cand-1/PASSPORT/uuid-scan.pdf', ...data },
  } as unknown as BullJob<R2DeleteJobData>;
}

describe('R2DeleteProcessor', () => {
  let storage: ReturnType<typeof makeStorageMock>;
  let processor: R2DeleteProcessor;

  beforeEach(() => {
    storage = makeStorageMock();
    processor = new R2DeleteProcessor(storage as unknown as StorageService);
  });

  it('deletes the object named in the job', async () => {
    await expect(processor.process(makeJob())).resolves.toEqual({ deleted: true });
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'candidates/cand-1/PASSPORT/uuid-scan.pdf',
    );
  });

  it('PROPAGATES a storage failure so BullMQ retries', async () => {
    // The alternative — catching and returning success — would convert "we
    // could not delete this" into "deleted", leaving the object in the bucket
    // while every record says it is gone. The throw is the point.
    storage.deleteObject.mockRejectedValueOnce(new Error('STORAGE_NOT_CONFIGURED: …'));
    await expect(processor.process(makeJob())).rejects.toThrow('STORAGE_NOT_CONFIGURED');
  });

  it('throws when the job carries no key rather than silently succeeding', async () => {
    await expect(processor.process(makeJob({ key: '' }))).rejects.toThrow(/no key/);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('ignores an unexpected job name without deleting anything', async () => {
    await expect(processor.process(makeJob({}, 'some-other-job'))).resolves.toEqual({
      deleted: false,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('is idempotent — a replayed job deletes the same key again harmlessly', async () => {
    // R2/S3 DeleteObject succeeds on an absent key, which is what makes the
    // backlog safe to drain: some of those objects were already swept by the
    // purge worker.
    await processor.process(makeJob());
    await processor.process(makeJob());
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('keeps the object key OUT of the log line (it embeds a candidate id)', async () => {
    const logSpy = jest
      .spyOn((processor as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);

    await processor.process(makeJob());

    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('cand-1');
    expect(logged).not.toContain('PASSPORT');
  });
});

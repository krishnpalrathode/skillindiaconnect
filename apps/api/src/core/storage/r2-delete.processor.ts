import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';
import { MAINTENANCE_WORKER_OPTS } from '../../queue/worker-tuning';
import { StorageService } from './storage.service';

/** Payload of a DELETE_OBJECT job. A key only — never a candidate id, never PII. */
export interface R2DeleteJobData {
  key: string;
}

/**
 * The DELETE_OBJECT consumer — the consumer the R2_DELETE queue never had.
 *
 * DocumentService.deleteDocument() has been enqueueing onto `r2-delete` since
 * S1, and nothing has ever consumed it. Every one of those jobs is still parked
 * in `bull:r2-delete:wait`: the DB row was deleted, the candidate was told the
 * document was gone, and the object stayed in the bucket. That is a data
 * -retention defect, not a queue-tuning one — a candidate who deletes a passport
 * scan is entitled to have the bytes destroyed, and DPDP erasure obligations do
 * not distinguish between "we forgot to build the worker" and "we chose not to".
 *
 * Deploying this drains the backlog on the first boot: every historical job
 * replays and the objects are finally removed. That is the intended behaviour —
 * they are all deletions that should already have happened.
 *
 * IDEMPOTENT BY CONSTRUCTION. S3/R2 DeleteObject succeeds on a key that is
 * already absent, so a retry, a redelivery, or a replay of a job whose first
 * attempt actually succeeded are all no-ops. This is what makes it safe for the
 * backlog to contain jobs whose objects were separately swept by the purge
 * worker (which destroys keys directly, in bulk).
 *
 * WORKER-ONLY. Lives in a module imported solely by AppWorkerModule — it must
 * NOT go in R2Module, which is @Global and loaded by the API process; a
 * processor there would start a consumer inside the API and violate
 * worker-and-external-sends.md.
 */
@Injectable()
@Processor(QUEUE_NAMES.R2_DELETE, MAINTENANCE_WORKER_OPTS)
export class R2DeleteProcessor extends WorkerHost {
  private readonly logger = new Logger(R2DeleteProcessor.name);

  constructor(private readonly storage: StorageService) {
    super();
  }

  async process(job: BullJob<R2DeleteJobData>): Promise<{ deleted: boolean }> {
    if (job.name !== JOB_NAMES.DELETE_OBJECT) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return { deleted: false };
    }

    const { key } = job.data;
    if (!key) {
      // Nothing to act on and nothing a retry could fix. Fail loudly rather than
      // reporting a deletion that did not happen.
      throw new Error('R2 delete job carries no key');
    }

    /**
     * An unconfigured bucket must NOT look like a successful deletion.
     *
     * StorageService.deleteObject throws STORAGE_NOT_CONFIGURED when R2 creds
     * are absent (they are optional at boot). Letting that throw is correct:
     * BullMQ retries, and after exhaustion the job sits in `failed` where it is
     * visible. Swallowing it would silently convert "we could not delete this"
     * into "deleted", which is the exact class of false claim the notification
     * pipeline is also careful to avoid.
     */
    await this.storage.deleteObject(key);

    // The key is a storage path, not PII — but it embeds a candidate id, so log
    // the job id instead and keep the key out of the log line entirely.
    this.logger.log(`r2 object deleted (job ${job.id ?? 'unknown'})`);
    return { deleted: true };
  }
}

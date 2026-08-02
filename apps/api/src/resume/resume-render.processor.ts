import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { RESPONSIVE_WORKER_OPTS } from '../queue/worker-tuning';
import { RENDER_TUNING } from '../pdf/render-tuning';
import { ResumeRenderService } from './resume-render.service';
import { RESUME_EVENTS, ResumeGeneratedPayload } from './resume.events';

/** Payload of a GENERATE_RESUME job (enqueued by S7-B2's POST /generate). */
export interface GenerateResumeJobData {
  generationId: string;
  candidateId: string;
}

/** Retry policy: transient render failures (timeout, browser crash) retry. */
export const RESUME_RENDER_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
} as const;

/**
 * The GENERATE_RESUME consumer (S7-B1, WORKER-ONLY — this is where Chromium
 * actually runs). Render → READY + `resume.generated` (S7-B2's subscriber
 * sends the RESUME_READY notification). A failed attempt retries via BullMQ;
 * exhaustion marks the generation FAILED so the FE's poll surfaces it.
 *
 * Audit meta is ids + size only — never profile content, never a phone/email
 * (no-PII-in-logs).
 */
@Injectable()
@Processor(QUEUE_NAMES.RESUME_RENDER, {
  // S8-H1: was BullMQ's implicit default of 1. Explicit and tunable now — this
  // is how many resume renders are in flight inside the worker; the Chromium
  // pool semaphore is the memory ceiling behind it. See render-tuning.ts.
  concurrency: RENDER_TUNING.resumeRenderConcurrency,
  // RESPONSIVE tier: the candidate is polling for this PDF. The stalled check
  // stays ON here — it is what reclaims a render lost to a wedged Chromium.
  ...RESPONSIVE_WORKER_OPTS,
})
export class ResumeRenderProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeRenderProcessor.name);

  constructor(
    private readonly renderService: ResumeRenderService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: BullJob<GenerateResumeJobData>): Promise<{ r2Key: string }> {
    if (job.name !== JOB_NAMES.GENERATE_RESUME) {
      this.logger.warn(`unknown job ${job.name} on ${QUEUE_NAMES.RESUME_RENDER}`);
      return { r2Key: '' };
    }

    const result = await this.renderService.renderGeneration(job.data.generationId);

    await this.auditService.log({
      actorRole: UserRole.SUPER_ADMIN, // system actor — worker-driven
      action: AUDIT_ACTIONS.RESUME_GENERATED,
      module: AUDIT_MODULES.CANDIDATE,
      targetType: 'ResumeGeneration',
      targetId: result.generationId,
      status: AuditStatus.SUCCESS,
      meta: {
        candidateId: job.data.candidateId,
        resumeId: result.resumeId,
        sizeBytes: result.sizeBytes,
      },
    });

    const payload: ResumeGeneratedPayload = {
      candidateId: job.data.candidateId,
      resumeId: result.resumeId,
      generationId: result.generationId,
    };
    this.eventEmitter.emit(RESUME_EVENTS.GENERATED, payload);

    return { r2Key: result.r2Key };
  }

  /** Retries exhausted → the generation flips FAILED (poll-visible). */
  @OnWorkerEvent('failed')
  async onFailed(job: BullJob<GenerateResumeJobData> | undefined): Promise<void> {
    if (!job || job.name !== JOB_NAMES.GENERATE_RESUME) return;
    const attemptsAllowed = job.opts.attempts ?? 1;
    if (job.attemptsMade < attemptsAllowed) return; // a retry is coming
    try {
      await this.renderService.markFailed(job.data.generationId);
      this.logger.warn(
        `generation ${job.data.generationId} FAILED after ${job.attemptsMade} attempts`,
      );
    } catch (err) {
      this.logger.error(
        `failed to mark generation ${job.data.generationId} FAILED: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob, Queue } from 'bullmq';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { InvoiceRenderService } from './invoice-render.service';
import { RENDER_TUNING } from '../pdf/render-tuning';

/** Payload of a RENDER_INVOICE job. */
export interface RenderInvoiceJobData {
  invoiceId: string;
}

export const INVOICE_RENDER_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
} as const;

/**
 * The RENDER_INVOICE consumer + THE BACKFILL (S7-B1, WORKER-ONLY).
 *
 * Two producers feed this queue:
 * 1. S5-B2's activation — a post-commit enqueue right after the invoice row is
 *    created (the edit lives in ActivationService's post-commit side effects).
 * 2. The DAILY BACKFILL SWEEP below — a cron that enqueues one job per
 *    remaining null-pdfKey invoice. This is both the one-off S5 backfill
 *    (invoices issued before this infra existed) and the permanent retry net
 *    for renders that exhausted their attempts.
 *
 * Idempotence, twice over: jobIds are deterministic
 * (`render-invoice-{invoiceId}` — '-' not ':' per BullMQ v5), so re-adds
 * dedupe; and InvoiceRenderService skips any invoice whose pdfKey is already
 * set — a second sweep run renders nothing twice.
 */
@Injectable()
@Processor(QUEUE_NAMES.INVOICE_RENDER, {
  // S8-H1: explicit and tunable (was BullMQ's implicit 1). Invoice renders share
  // the SAME Chromium pool as resume renders — the two concurrencies together
  // must stay within the pool cap. See pdf/render-tuning.ts.
  concurrency: RENDER_TUNING.invoiceRenderConcurrency,
})
export class InvoiceRenderProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceRenderProcessor.name);

  constructor(
    private readonly renderService: InvoiceRenderService,
    private readonly auditService: AuditService,
    @InjectQueue(QUEUE_NAMES.INVOICE_RENDER) private readonly queue: Queue,
  ) {
    super();
  }

  async process(
    job: BullJob<RenderInvoiceJobData>,
  ): Promise<{ pdfKey: string } | { enqueued: number }> {
    switch (job.name) {
      case JOB_NAMES.INVOICE_BACKFILL_SWEEP:
        return this.sweep();
      case JOB_NAMES.RENDER_INVOICE: {
        const { pdfKey, skipped } = await this.renderService.renderInvoice(job.data.invoiceId);
        if (!skipped) {
          await this.auditService.log({
            actorRole: UserRole.SUPER_ADMIN, // system actor — worker-driven
            action: AUDIT_ACTIONS.INVOICE_PDF_RENDERED,
            module: AUDIT_MODULES.PAYMENTS,
            targetType: 'Invoice',
            targetId: job.data.invoiceId,
            status: AuditStatus.SUCCESS,
            meta: {}, // the id IS the record; amounts live on the row
          });
        }
        return { pdfKey };
      }
      default:
        this.logger.warn(`unknown job ${job.name} on ${QUEUE_NAMES.INVOICE_RENDER}`);
        return { enqueued: 0 };
    }
  }

  /**
   * Daily 03:10 UTC: enqueue-only, deterministic jobIds (cron-queue-dedupe).
   * The sweep itself dedupes per day; the per-invoice jobs dedupe per invoice.
   */
  @Cron('10 3 * * *')
  async scheduleBackfillSweep(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.queue.add(
      JOB_NAMES.INVOICE_BACKFILL_SWEEP,
      {},
      { jobId: `invoice-backfill-sweep-${day}` },
    );
  }

  private async sweep(): Promise<{ enqueued: number }> {
    const ids = await this.renderService.findUnrendered();
    // Per-DAY jobIds (the S6b-B1 purge lesson): a completed-but-failed
    // `render-invoice-{id}` would dedupe-swallow every later re-add under the
    // same id, and the invoice would never render. The day suffix gives each
    // sweep a fresh id while still deduping within the day.
    const day = new Date().toISOString().slice(0, 10);
    for (const invoiceId of ids) {
      await this.queue.add(
        JOB_NAMES.RENDER_INVOICE,
        { invoiceId } satisfies RenderInvoiceJobData,
        { jobId: `render-invoice-${invoiceId}-${day}`, ...INVOICE_RENDER_JOB_OPTS },
      );
    }
    this.logger.log(`invoice backfill sweep enqueued ${ids.length} render(s)`);
    return { enqueued: ids.length };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * Profile-completion nudge cron — fires every hour at minute 15.
 *
 * ── Why HOURLY, when every other sweep here is daily ──────────────────────
 * The requirement is "after 24 hours". A daily cron cannot honour that: someone
 * who registers at 09:00 is either caught the next morning (24h, correct) or
 * missed and caught the morning after (48h, wrong) depending purely on which
 * side of the run their signup fell. Hourly bounds the delay to 24–25 hours for
 * everybody, which is what "after 24 hours" means to the person receiving it.
 *
 * The cost is 24 scans a day instead of one, and the scan is a narrow indexed
 * window (24h to 7d old, still below the threshold, not yet nudged) rather than
 * a walk of every profile — see profile-nudge.processor.ts.
 *
 * ── Minute 15 ─────────────────────────────────────────────────────────────
 * Deliberately clear of the minute-0, minute-10 and minute-30 slots the purge,
 * passport-expiry, auto-archive and inactivity sweeps already occupy, so an
 * hourly job never collides with a daily one competing for the same connection
 * pool.
 *
 * Per cron-queue-dedupe.md this does NOTHING but enqueue, with a jobId derived
 * from the hour so BullMQ collapses duplicate fires across worker replicas.
 * Without it a second replica would send every candidate a second WhatsApp —
 * a paid message the recipient definitely notices.
 */
@Injectable()
export class ProfileNudgeCron {
  private readonly logger = new Logger(ProfileNudgeCron.name);

  constructor(@InjectQueue(QUEUE_NAMES.PROFILE_NUDGE) private readonly queue: Queue) {}

  @Cron('15 * * * *')
  async scheduleProfileNudgeScan(): Promise<void> {
    // Hour granularity, e.g. 2026-08-23T14 — the logical window this run covers.
    const hour = new Date().toISOString().slice(0, 13);
    // HYPHENS, never a colon: BullMQ 5 rejects a custom jobId containing ':' at
    // runtime, so the slice above is re-joined with '-' rather than used raw
    // (an ISO timestamp carries colons) and the scan would otherwise never be
    // enqueued at all.
    const jobId = `profile-nudge-scan-${hour.replace(/[:T]/g, '-')}`;
    await this.queue.add(JOB_NAMES.PROFILE_NUDGE_SCAN, {}, { jobId });
    this.logger.log(`Enqueued profile nudge scan (jobId: ${jobId})`);
  }
}

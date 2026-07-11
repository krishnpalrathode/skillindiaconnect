import { NotificationType } from '@prisma/client';

/** Payload passed to NotificationService.notify() and carried in the BullMQ job. */
export interface NotifyPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** BullMQ job shape for QUEUE_NAMES.NOTIFICATION jobs. */
export interface NotificationJobData {
  userId: string;
  type: NotificationType;
  channel: 'whatsapp' | 'email';
  payload: NotifyPayload;
  /**
   * Set by the WhatsApp processor (via job.updateData) after it creates the
   * delivery row on the FIRST attempt, so BullMQ retries UPDATE that same row
   * instead of minting a new one per attempt — one row per logical send.
   */
  waMessageRowId?: string;
}

/** BullMQ retry configuration for notification channel jobs. */
export const NOTIFICATION_JOB_ATTEMPTS = 3;
export const NOTIFICATION_JOB_BACKOFF_MS = 2_000; // initial exponential delay

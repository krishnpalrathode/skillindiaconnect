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
}

/** BullMQ retry configuration for notification channel jobs. */
export const NOTIFICATION_JOB_ATTEMPTS = 3;
export const NOTIFICATION_JOB_BACKOFF_MS = 2_000; // initial exponential delay

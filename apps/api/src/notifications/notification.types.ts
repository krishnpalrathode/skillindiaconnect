import { NotificationType } from '@prisma/client';

/** Payload passed to NotificationService.notify() and carried in the BullMQ job. */
export interface NotifyPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * The `data` keys that drive a WhatsApp TEMPLATE send (CR-WA W0).
 *
 * WHY THE CALLER SUPPLIES THESE, not the notification worker: a WhatsApp
 * template needs the candidate's name, the job title, the company — facts owned
 * by the applications, jobs and employer modules. Resolving them inside the
 * notification processor would mean that module querying tables it does not own
 * (module-boundaries Rule 4). The module RAISING the notification already has
 * the data in hand, so it passes it; the notification module stays deliberately
 * ignorant of what a job title is.
 *
 * ⚠️ THE COST OF THAT CHOICE, STATED PLAINLY: the responsibility is spread
 * across every producer of a whatsapp-tier notification rather than held in one
 * place. Today that is THREE call sites:
 *
 *   applications/status.service.ts       APPLICATION_SELECTED (employer selects)
 *   applications/admin-resend.service.ts APPLICATION_SELECTED (admin resend)
 *   resume/resume-delivery.service.ts    RESUME_SENT (+ document)
 *
 * A NEW whatsapp-tier type, or a new producer of an existing one, must supply
 * its own parameters — and nothing structural can force it to. Startup
 * validation cannot see call sites, and a compile-time check does not bite
 * because callers pass an already-widened NotificationType rather than a
 * literal. The backstops are: a loud error log at enqueue
 * (NotificationService.notify) naming the omission at its source, and the
 * worker marking the row FAILED and falling back to email rather than sending
 * a message with holes in it.
 *
 * These never reach the client: notification.mapper.ts is a whitelist that
 * surfaces only relatedEntityId/relatedEntityType and drops raw `data`.
 */
/**
 * ORDERED body parameters, matching the approved template's {{1}}..{{n}}.
 * Order is the contract — see WhatsappTemplateSend. Snapshotted at enqueue, so
 * the message states what was true when the event happened.
 */
export const WA_TEMPLATE_VARS_KEY = 'templateVars';

/**
 * R2 object key for a document-header template. A KEY, not a signed url and not
 * bytes: the worker resolves it at send time. A signed url would expire sitting
 * in Redis; bytes would bloat the job.
 */
export const WA_DOCUMENT_KEY = 'documentKey';

/**
 * The filename the recipient sees in WhatsApp.
 *
 * Supplied by the RAISING module, not derived here. The notification worker
 * does not know that a given document is a résumé, an invoice or a certificate,
 * so it cannot name one — and deriving the name from bodyParams[0] would make
 * the filename silently depend on a template's parameter ORDER.
 */
export const WA_DOCUMENT_FILENAME_KEY = 'documentFilename';

/** Reads the ordered template params out of a notify payload, or null. */
export function readTemplateVars(data: Record<string, unknown> | undefined): string[] | null {
  const raw = data?.[WA_TEMPLATE_VARS_KEY];
  if (!Array.isArray(raw)) return null;
  return raw.every((v) => typeof v === 'string') ? (raw as string[]) : null;
}

/** Reads the document R2 key out of a notify payload, or null. */
export function readDocumentKey(data: Record<string, unknown> | undefined): string | null {
  const raw = data?.[WA_DOCUMENT_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Reads the recipient-visible filename, or a neutral default.
 *
 * The default is deliberately generic: the notification module cannot know what
 * the document IS, so guessing would be worse than being plain. A producer that
 * attaches a document should always supply this.
 */
export function readDocumentFilename(data: Record<string, unknown> | undefined): string {
  const raw = data?.[WA_DOCUMENT_FILENAME_KEY];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : 'document.pdf';
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

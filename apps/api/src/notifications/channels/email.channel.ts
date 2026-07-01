export const EMAIL_CHANNEL = 'EMAIL_CHANNEL';

export interface EmailSendResult {
  ok: boolean;
  providerMessageId?: string;
  /** True when the address permanently bounced (hard bounce). */
  bounced?: boolean;
  errorCode?: string;
}

/**
 * Injectable channel interface for outbound email sends.
 *
 * MVP binding: MockEmailChannel (records + in-memory store).
 * Production swap (S8): replace `useClass: MockEmailChannel` → `useClass: SesEmailAdapter`
 * in channels.module.ts — no NotificationProcessor change required.
 */
export interface EmailChannel {
  send(
    to: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<EmailSendResult>;
}

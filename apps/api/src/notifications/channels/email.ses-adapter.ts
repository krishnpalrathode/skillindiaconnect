import { Injectable } from '@nestjs/common';
import type { EmailChannel, EmailSendResult } from './email.channel';

/**
 * AWS SES email adapter — STUB.
 *
 * TODO: wire when AWS SES production access is approved (S8).
 *
 * To activate:
 * 1. Install @aws-sdk/client-ses and configure SES credentials via env vars.
 * 2. Implement send() using SESClient.sendEmail() / sendTemplatedEmail().
 * 3. In channels.module.ts, change the EMAIL_CHANNEL binding:
 *    { provide: EMAIL_CHANNEL, useClass: SesEmailAdapter }
 *    — no NotificationProcessor change required.
 *
 * The SES delivery / bounce webhook (S5) will call
 * NotificationService.updateEmailDeliveryStatus() to transition
 * email_messages: SENT → DELIVERED / BOUNCED.
 */
@Injectable()
export class SesEmailAdapter implements EmailChannel {
  async send(
    _to: string,
    _type: string,
    _payload: Record<string, unknown>,
  ): Promise<EmailSendResult> {
    throw new Error(
      'SesEmailAdapter is not configured. AWS SES production access is pending (S8). ' +
        'Use MockEmailChannel for local/test environments.',
    );
  }
}

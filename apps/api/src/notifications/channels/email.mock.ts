import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailChannel, EmailSendResult } from './email.channel';

/** Sending to this address simulates a hard bounce — exercisable in tests without real SES. */
export const MOCK_BOUNCE_EMAIL = 'bounce@mock.test';

/** Sending to this address simulates a transient send failure (errorCode returned). */
export const MOCK_FAIL_EMAIL = 'fail@mock.test';

@Injectable()
export class MockEmailChannel implements EmailChannel {
  private readonly _sent: Array<{ to: string; type: string; messageId: string }> = [];

  async send(
    to: string,
    type: string,
    _payload: Record<string, unknown>,
  ): Promise<EmailSendResult> {
    if (to === MOCK_BOUNCE_EMAIL) {
      return { ok: false, bounced: true };
    }
    if (to === MOCK_FAIL_EMAIL) {
      return { ok: false, errorCode: 'MOCK_SEND_ERROR' };
    }

    // PII-safe debug log — address is masked.
    if (process.env['NODE_ENV'] === 'development') {
      console.debug(`[MockEmail] send type=${type} to=[REDACTED]`);
    }

    const messageId = `mock-email-${randomUUID()}`;
    this._sent.push({ to, type, messageId });
    return { ok: true, providerMessageId: messageId };
  }

  /** Test-only: the full send log. Never expose in production. */
  getSentEmails(): Array<{ to: string; type: string; messageId: string }> {
    return [...this._sent];
  }

  /** Test-only: reset the in-memory log between tests. */
  clearSentEmails(): void {
    this._sent.length = 0;
  }
}

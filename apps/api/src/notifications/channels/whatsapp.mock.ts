import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WhatsappChannel, WhatsappSendResult } from './whatsapp.channel';

// Numbers ending with '0000' simulate a phone not registered on WhatsApp.
const NOT_ON_WHATSAPP_SUFFIX = '0000';

@Injectable()
export class MockWhatsappChannel implements WhatsappChannel {
  private readonly _sentCodes = new Map<string, string>();
  private readonly _sentTemplates = new Map<string, string>();

  async sendOtp(
    phone: string,
    code: string,
    purpose: 'PHONE_VERIFY' | 'LOGIN',
  ): Promise<WhatsappSendResult> {
    if (phone.endsWith(NOT_ON_WHATSAPP_SUFFIX)) {
      return { ok: false, notOnWhatsapp: true };
    }

    // Dev-only debug line — intentionally does NOT log the raw code (no-PII rule).
    if (process.env['NODE_ENV'] === 'development') {
      console.debug(`[MockWhatsApp] sendOtp purpose=${purpose} phone=*** code=[REDACTED]`);
    }

    this._sentCodes.set(phone, code);
    return { ok: true, providerMessageId: `mock-${randomUUID()}` };
  }

  /** Test-only: retrieve the last code "sent" to a phone number. */
  getLastSentCode(phone: string): string | undefined {
    return this._sentCodes.get(phone);
  }

  async sendTemplate(
    phone: string,
    templateKey: string,
    _vars: Record<string, string>,
  ): Promise<WhatsappSendResult> {
    if (phone.endsWith(NOT_ON_WHATSAPP_SUFFIX)) {
      return { ok: false, notOnWhatsapp: true };
    }
    if (process.env['NODE_ENV'] === 'development') {
      console.debug(`[MockWhatsApp] sendTemplate template=${templateKey} phone=***`);
    }
    const messageId = `mock-tpl-${randomUUID()}`;
    this._sentTemplates.set(`${phone}:${templateKey}`, messageId);
    return { ok: true, providerMessageId: messageId };
  }

  /** Test-only: retrieve the last template message id sent to phone+template. */
  getLastTemplateMessageId(phone: string, templateKey: string): string | undefined {
    return this._sentTemplates.get(`${phone}:${templateKey}`);
  }

  /** Test-only: reset the in-memory send log between tests. */
  clearSentCodes(): void {
    this._sentCodes.clear();
    this._sentTemplates.clear();
  }
}

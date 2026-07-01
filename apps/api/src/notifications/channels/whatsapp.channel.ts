export const WHATSAPP_CHANNEL = 'WHATSAPP_CHANNEL';

export interface WhatsappSendResult {
  ok: boolean;
  providerMessageId?: string;
  notOnWhatsapp?: boolean;
  errorCode?: string;
}

/**
 * Injectable channel interface for outbound WhatsApp sends.
 *
 * MVP binding: MockWhatsappChannel (logs + in-memory store).
 * Production swap: replace `useClass: MockWhatsappChannel` → `useClass: MetaWhatsappChannel`
 * in channels.module.ts — no OtpService or NotificationProcessor change required.
 */
export interface WhatsappChannel {
  /** Send a one-time password via the Meta WhatsApp auth template. */
  sendOtp(
    phone: string,
    code: string,
    purpose: 'PHONE_VERIFY' | 'LOGIN',
  ): Promise<WhatsappSendResult>;

  /**
   * Send a notification via a named WhatsApp Business template.
   * Used for APPLICATION_SELECTED (wa.selected) and RESUME_SENT (wa.resume_doc).
   */
  sendTemplate(
    phone: string,
    templateKey: string,
    vars: Record<string, string>,
  ): Promise<WhatsappSendResult>;
}

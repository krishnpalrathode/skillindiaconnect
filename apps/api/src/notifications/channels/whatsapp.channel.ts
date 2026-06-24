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
 * in whatsapp.module.ts — no OtpService change required.
 */
export interface WhatsappChannel {
  sendOtp(
    phone: string,
    code: string,
    purpose: 'PHONE_VERIFY' | 'LOGIN',
  ): Promise<WhatsappSendResult>;
}

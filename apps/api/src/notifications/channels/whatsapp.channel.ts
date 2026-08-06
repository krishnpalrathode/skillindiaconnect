export const WHATSAPP_CHANNEL = 'WHATSAPP_CHANNEL';

export interface WhatsappSendResult {
  ok: boolean;
  providerMessageId?: string;
  notOnWhatsapp?: boolean;
  errorCode?: string;
}

/**
 * A document to attach as the template's HEADER (CR-WA W0).
 *
 * BYTES, not a URL. Meta fetches a URL asynchronously, and every document url
 * this platform mints is a SHORT-EXPIRY SIGNED R2 url — it would routinely be
 * dead by the time Meta pulled it. The bytes are resolved at SEND time, in the
 * worker, and never travel through Redis in the job payload.
 */
export interface WhatsappDocument {
  /** What the candidate sees in WhatsApp — human, never a uuid. */
  filename: string;
  bytes: Buffer;
  mimeType: string;
}

/**
 * Everything a template send needs beyond the recipient and the template key.
 *
 * `bodyParams` is an ORDERED ARRAY because Meta's template parameters are
 * POSITIONAL ({{1}}, {{2}}, {{3}}). A named map would need a second mapping to
 * positions — one more place for the order to drift from the approved template,
 * and a drifted order produces a message that reads plausibly and is wrong
 * ("selected for Gulf Wiring LLC at Senior Electrician"). The order IS the
 * contract; it is fixed by the approved template and must not be re-sorted.
 */
export interface WhatsappTemplateSend {
  bodyParams: string[];
  document?: WhatsappDocument;
}

/**
 * Injectable channel interface for outbound WhatsApp sends.
 *
 * MVP binding: MockWhatsappChannel (logs + in-memory store).
 * Production swap: replace `useClass: MockWhatsappChannel` → `useClass: MetaWhatsappChannel`
 * in channels.module.ts — no OtpService or NotificationProcessor change required.
 *
 * ⚠️ WHATSAPP_CHANNEL IS BOUND IN TWO MODULES, IN TWO PROCESSES:
 *   whatsapp.module.ts → the API process (AuthModule → OtpService.sendOtp)
 *   channels.module.ts → the WORKER process (notification sends)
 * A real adapter must be bound in BOTH. Converting only one leaves the other
 * silently on the mock — notifications would send for real while OTPs sent
 * nothing, with no error anywhere.
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
    send: WhatsappTemplateSend,
  ): Promise<WhatsappSendResult>;
}

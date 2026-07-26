export const EMAIL_CHANNEL = 'EMAIL_CHANNEL';

export interface EmailSendResult {
  ok: boolean;
  providerMessageId?: string;
  /** True when the address permanently bounced (hard bounce). */
  bounced?: boolean;
  errorCode?: string;
}

/**
 * A provider-neutral attachment (the resume PDF is the driving case — S7-B2's
 * email-to-self and the whatsappCapable→email resume fallback). Deliberately
 * carries NO SMTP/SES concept: just a filename, the bytes, and a MIME type.
 * SES (SendRawEmail) and SMTP (Nodemailer) both accept exactly this.
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Injectable channel interface for outbound email sends — THE provider-neutral
 * PORT (audited for the SES-swap seam).
 *
 * ⚠️ NEUTRALITY (the whole point of the seam): this port speaks "email," never
 * "SMTP" or "SES." There is NO transport/host/port/pool here, and NO
 * region/config-set — those live INSIDE an adapter. A single leaked provider
 * concept would break the future one-adapter SES swap. Verified by
 * email-channel.neutrality.spec.ts (a structural guard).
 *
 * Bindings (config-selected by EMAIL_PROVIDER via email-channel.factory.ts):
 *   - `mock`  → MockEmailChannel (dev/test/CI; the existing S2-B3 mock).
 *   - `titan` → TitanSmtpEmailChannel (Nodemailer/Titan; production email).
 *   - `ses`   → a future SesEmailChannel — implements THIS interface UNCHANGED;
 *               no caller, processor, or interface change is needed to add it.
 *
 * Call shape (kept from S2-B3 so the swap is transparent to every caller): the
 * caller says who it is TO (`to`) and WHAT kind of message (`type` + a neutral
 * `payload`); the adapter knows who it is FROM (adapter config — the authorized
 * sender is a provider concern: a Titan mailbox now, an SES identity later).
 *
 * The `payload` may carry these RESERVED provider-neutral keys, which any
 * adapter honors when present and otherwise derives sensibly from `type`. This
 * is what lets a caller enrich content (or attach the resume PDF) LATER with
 * ZERO port or adapter change:
 *   - `subject?: string`
 *   - `html?: string`
 *   - `text?: string`
 *   - `from?: string`                  // optional per-send override of EMAIL_FROM
 *   - `attachments?: EmailAttachment[]`
 */
export interface EmailChannel {
  send(
    to: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<EmailSendResult>;
}

/**
 * The neutral, fully-resolved message an adapter actually sends — what a
 * `send(to, type, payload)` call resolves to via `resolveOutboundEmail`. Still
 * provider-neutral (no SMTP/SES here); adapters map it onto their SDK.
 */
export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

/**
 * Resolve a `(to, type, payload)` call into the neutral `OutboundEmail` an
 * adapter sends. Reserved payload keys (subject/html/text/from/attachments)
 * win when present; otherwise content is derived generically from `type`.
 *
 * NOTE (documented limitation, not a bug): the S2-B3 processor currently passes
 * only `payload.data` to `send()`, so existing notification types arrive with
 * no `subject`/`text` and get a generic transactional body here. Richer,
 * per-type copy is a caller-side enhancement — a caller populating the reserved
 * keys above needs NO change to this port or any adapter. Kept out of THIS unit
 * (which is the channel/seam) to hold "transparent swap, no caller change."
 */
export function resolveOutboundEmail(
  to: string,
  type: string,
  payload: Record<string, unknown>,
  defaultFrom: string,
): OutboundEmail {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  const subject = str(payload['subject']) ?? humanizeType(type);
  const text = str(payload['text']) ?? str(payload['body']) ?? defaultBody(type);
  const html = str(payload['html']) ?? `<p>${escapeHtml(text)}</p>`;
  const from = str(payload['from']) ?? defaultFrom;
  const attachments = asAttachments(payload['attachments']);

  return { to, from, subject, text, html, ...(attachments && { attachments }) };
}

function asAttachments(v: unknown): EmailAttachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (a): a is EmailAttachment =>
      !!a &&
      typeof (a as EmailAttachment).filename === 'string' &&
      Buffer.isBuffer((a as EmailAttachment).content) &&
      typeof (a as EmailAttachment).contentType === 'string',
  );
  return out.length > 0 ? out : undefined;
}

/** 'SUBSCRIPTION_PURCHASED' → 'Subscription purchased'. */
function humanizeType(type: string): string {
  const words = type.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Notification';
}

function defaultBody(type: string): string {
  return `You have a new ${humanizeType(type).toLowerCase()} notification from SkillIndiaConnect.`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

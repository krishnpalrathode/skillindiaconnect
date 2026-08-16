import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  EmailChannel,
  EmailSendResult,
  OutboundEmail,
  resolveOutboundEmail,
} from './email.channel';

/** Resolved Resend settings — provider-specific, and CONFINED to this adapter. */
interface ResendConfig {
  apiKey: string;
  from: string;
  endpoint: string;
  timeoutMs: number;
}

/**
 * The JSON body `POST /emails` expects. Snake_case (`content_type`) is Resend's
 * wire format, not ours — another reason it lives in here and nowhere else.
 */
interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; content_type: string }>;
}

/** What `post` hands back — kept minimal so the test seam is easy to stub. */
export interface ResendResponse {
  status: number;
  body?: { id?: string; name?: string; message?: string } | undefined;
}

/**
 * Resend adapter (HTTPS) — the production email channel.
 *
 * WHY HTTP AND NOT SMTP: the worker runs on a host that silently drops outbound
 * SMTP. Connects to smtp.titan.email on 465, 587 AND 25 all time out, while
 * :443 is open. That is a firewall policy, not a credential problem, and it is
 * not fixable from inside the app — so the transport itself has to be HTTPS.
 * Port-blocking cannot affect this adapter.
 *
 * THE PROVIDER BOUNDARY: every Resend/HTTP concept lives inside THIS class. The
 * port it implements ([email.channel.ts](./email.channel.ts)) knows nothing of
 * endpoints, API keys, or status codes — which is what kept this migration to
 * one new file plus one `case` in the factory, touching no interface and no
 * caller.
 *
 * WORKER-ONLY: constructed only inside ChannelsModule, which is imported only by
 * the notification WORKER module. The API process enqueues; the worker sends
 * (worker-and-external-sends.md).
 *
 * FROM is adapter config (EMAIL_FROM — a sender on a domain VERIFIED in Resend),
 * never a per-call argument; a caller MAY override per-send via `payload.from`,
 * but that address must also be on a verified domain or Resend rejects it 403.
 *
 * HONESTY: `ok:true` means Resend ACCEPTED the message (2xx + an id), NOT that
 * it was delivered — real delivery and bounces arrive asynchronously via Resend
 * webhooks (the BounceHandler seam, bounce-handler.port.ts). Any non-2xx or
 * thrown error returns `ok:false` with a coarse code so the S2-B3 processor runs
 * its existing retry/fallback. A failure is NEVER laundered into a false SENT.
 */
@Injectable()
export class ResendEmailChannel implements EmailChannel {
  private readonly logger = new Logger(ResendEmailChannel.name);
  private readonly config: ResendConfig;

  constructor(config: ConfigService) {
    // Fail LOUDLY at construction on bad config — a worker that can't send email
    // must not boot into a silent black hole.
    this.config = this.readConfig(config);
  }

  async send(to: string, type: string, payload: Record<string, unknown>): Promise<EmailSendResult> {
    const email = resolveOutboundEmail(to, type, payload, this.config.from);
    try {
      const { status, body } = await this.post(this.toResend(email));

      if (status >= 200 && status < 300) {
        const id = typeof body?.id === 'string' ? body.id : undefined;
        this.logSafe(to, type, 'SENT', id);
        return { ok: true, providerMessageId: id };
      }

      this.logSafe(to, type, 'FAILED');
      return { ok: false, errorCode: classifyStatus(status) };
    } catch (err) {
      // Network/timeout/abort — honest FAILED; the caller retries.
      this.logSafe(to, type, 'FAILED');
      return { ok: false, errorCode: classifyError(err) };
    }
  }

  /** Map the neutral OutboundEmail onto Resend's wire shape. */
  private toResend(email: OutboundEmail): ResendPayload {
    return {
      from: email.from,
      // Resend takes an ARRAY of recipients; the port is single-recipient by
      // design (one row per send in whatsapp_messages/email_messages).
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.attachments && {
        attachments: email.attachments.map((a) => ({
          filename: a.filename,
          // Resend takes attachment bytes base64-encoded over JSON — this is the
          // resume-PDF path (S7-B2 email-to-self + the WhatsApp→email fallback).
          content: a.content.toString('base64'),
          content_type: a.contentType,
        })),
      }),
    };
  }

  private readConfig(config: ConfigService): ResendConfig {
    const apiKey = config.get<string>('RESEND_API_KEY');
    const from = config.get<string>('EMAIL_FROM');
    if (!apiKey || !from) {
      throw new Error(
        'Resend email is not configured — RESEND_API_KEY and EMAIL_FROM are ' +
          'both required when EMAIL_PROVIDER=resend.',
      );
    }
    return {
      apiKey,
      from,
      endpoint: config.get<string>('RESEND_ENDPOINT') ?? 'https://api.resend.com/emails',
      // An EXPLICIT timeout, for the same reason the SMTP adapter carries one:
      // a request that hangs longer than BullMQ's stalled-job window is never
      // seen as a failure — the job is reclaimed and re-processed forever with
      // attemptsMade stuck at 0, so the retry cap never trips.
      timeoutMs: Number(config.get<string | number>('RESEND_TIMEOUT_MS') ?? 10_000),
    };
  }

  /**
   * The single HTTP call. `protected` is the TEST SEAM — a spec subclass
   * overrides it to assert on the built payload and to simulate provider
   * responses, with no network and no API key.
   */
  protected async post(body: ResendPayload): Promise<ResendResponse> {
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    // A non-2xx may still carry a JSON error document; a 5xx may carry HTML.
    // Never let response parsing turn a clean status into an exception.
    let parsed: ResendResponse['body'];
    try {
      parsed = (await res.json()) as ResendResponse['body'];
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed };
  }

  /**
   * Redaction-safe send log (no-PII rule): the recipient is reduced to a
   * SHA-256 prefix + its domain — enough to correlate a delivery incident,
   * never the address itself; the subject/body/attachments are never logged.
   */
  private logSafe(to: string, type: string, status: 'SENT' | 'FAILED', messageId?: string): void {
    const domain = to.includes('@') ? to.slice(to.lastIndexOf('@') + 1) : 'unknown';
    const toHash = createHash('sha256').update(to).digest('hex').slice(0, 12);
    this.logger.log(
      `email ${status} type=${type} to=${toHash}@${domain}${messageId ? ` msgId=${messageId}` : ''}`,
    );
  }
}

/**
 * A coarse, redaction-safe code from the HTTP status. Resend's error body can
 * echo the recipient address, so it is deliberately NOT used here.
 */
function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return 'EAUTH';
  if (status === 422) return 'INVALID_REQUEST';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_ERROR';
  return `HTTP_${status}`;
}

/** A coarse, redaction-safe error code — never the raw message (may hold PII). */
function classifyError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  // AbortSignal.timeout rejects with a TimeoutError; an explicit abort gives
  // AbortError. Both mean "took too long", which is what the retry cares about.
  if (name === 'TimeoutError' || name === 'AbortError') return 'ETIMEDOUT';
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && code.length > 0) return code; // e.g. 'ENOTFOUND'
  return 'RESEND_SEND_ERROR';
}

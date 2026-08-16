import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import {
  EmailChannel,
  EmailSendResult,
  OutboundEmail,
  resolveOutboundEmail,
} from './email.channel';

/** Resolved SMTP settings — Titan-specific, and CONFINED to this adapter. */
interface TitanSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Titan Email SMTP adapter (Nodemailer) — the production email channel.
 *
 * THE PROVIDER BOUNDARY: every SMTP/Nodemailer concept lives inside THIS class.
 * The port it implements ([email.channel.ts](./email.channel.ts)) knows nothing
 * of hosts, ports, TLS, pools, or messageIds — which is exactly what makes the
 * future SES swap a single new adapter + an EMAIL_PROVIDER flip, touching no
 * interface and no caller.
 *
 * WORKER-ONLY: constructed only inside ChannelsModule, which is imported only by
 * the notification WORKER module. The API process enqueues; the worker sends
 * (worker-and-external-sends.md). No SMTP connection is ever opened API-side.
 *
 * FROM is adapter config (EMAIL_FROM — the authorized Titan mailbox), never a
 * per-call argument; a caller MAY override per-send via `payload.from`.
 *
 * HONESTY: `ok:true` means accepted-for-relay (the SMTP server took it), NOT
 * delivered — true delivery/bounce is Titan's async concern (see
 * bounce-handler.port.ts). A per-recipient rejection or any thrown transport
 * error returns `ok:false` so the S2-B3 processor runs its existing
 * retry/fallback. A failure is NEVER laundered into a false SENT.
 *
 * DAILY SEND LIMIT: Titan caps per-mailbox daily volume (plan-dependent, low
 * hundreds). A fan-out burst (an approval wave, the passport-expiry cron batch)
 * can approach it; the BullMQ email queue is the natural rate-limit seam, and
 * hitting this ceiling is the documented trigger to migrate to SES.
 */
@Injectable()
export class TitanSmtpEmailChannel implements EmailChannel {
  private readonly logger = new Logger(TitanSmtpEmailChannel.name);
  private readonly from: string;
  protected readonly transporter: Transporter;

  constructor(config: ConfigService) {
    const smtp = this.readConfig(config);
    this.from = smtp.from;
    // Fail LOUDLY at construction on bad config — a worker that can't send email
    // must not boot into a silent black hole.
    this.transporter = this.createTransport(smtp);
  }

  async send(to: string, type: string, payload: Record<string, unknown>): Promise<EmailSendResult> {
    const email = resolveOutboundEmail(to, type, payload, this.from);
    try {
      const info = (await this.transporter.sendMail(this.toNodemailer(email))) as {
        messageId?: string;
        accepted?: unknown[];
        rejected?: unknown[];
      };

      // Accepted-for-relay = no per-recipient rejection and no throw. (SMTP
      // populates `rejected`; the stream/JSON transports used in tests leave it
      // empty — both resolve to SENT here, which is the honest reading.)
      if ((info.rejected?.length ?? 0) > 0) {
        this.logSafe(to, type, 'FAILED');
        return { ok: false, errorCode: 'RECIPIENT_REJECTED' };
      }
      this.logSafe(to, type, 'SENT', info.messageId);
      return { ok: true, providerMessageId: info.messageId };
    } catch (err) {
      // Transport/auth/connection error — honest FAILED; the caller retries.
      this.logSafe(to, type, 'FAILED');
      return { ok: false, errorCode: classifyError(err) };
    }
  }

  /** Map the neutral OutboundEmail onto Nodemailer's shape (SMTP concept). */
  private toNodemailer(email: OutboundEmail): SendMailOptions {
    return {
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.attachments && {
        attachments: email.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      }),
    };
  }

  private readConfig(config: ConfigService): TitanSmtpConfig {
    const host = config.get<string>('TITAN_SMTP_HOST');
    const port = Number(config.get<string | number>('TITAN_SMTP_PORT') ?? 465);
    const user = config.get<string>('TITAN_SMTP_USER');
    const pass = config.get<string>('TITAN_SMTP_PASS');
    const from = config.get<string>('EMAIL_FROM');
    if (!host || !user || !pass || !from) {
      throw new Error(
        'Titan email is not configured — TITAN_SMTP_HOST, TITAN_SMTP_USER, ' +
          'TITAN_SMTP_PASS and EMAIL_FROM are all required when EMAIL_PROVIDER=titan.',
      );
    }
    return { host, port, user, pass, from };
  }

  /**
   * Build the pooled Nodemailer transport. `protected` is the TEST SEAM — a
   * spec subclass overrides this to inject a stream transport (no network),
   * proving message-building/attachments without touching real Titan.
   *
   * POOLING is deliberate: the worker sends many transactional mails; a fresh
   * SMTP connection per send is slow and trips Titan's connection limits.
   * `secure` follows the port — 465 is implicit TLS, 587 is STARTTLS (upgraded
   * via `requireTLS`).
   */
  protected createTransport(smtp: TitanSmtpConfig): Transporter {
    const secure = smtp.port === 465;
    return createTransport({
      host: smtp.host,
      port: smtp.port,
      secure,
      requireTLS: !secure, // 587 → force STARTTLS; never send credentials in clear
      auth: { user: smtp.user, pass: smtp.pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // EXPLICIT timeouts — nodemailer's defaults (2min connect / 10min socket)
      // are far longer than BullMQ's stalled-job window, so a network that
      // silently blackholes SMTP (a host that blocks outbound 465/587, a DNS
      // hole) does NOT surface as a failure. The job holds its lock past the
      // stall threshold, gets reclaimed, and is re-processed forever WITHOUT
      // incrementing attemptsMade — so the retry cap never trips and the
      // fallback in the processor is never reached. Timing out inside the stall
      // window converts that infinite loop into an honest FAILED + errorCode
      // ('ETIMEDOUT'/'ECONNECTION'), which is what the retry/fallback expects.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
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

/** A coarse, redaction-safe error code — never the raw message (may hold PII). */
function classifyError(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && code.length > 0) return code; // e.g. 'EAUTH', 'ECONNECTION', 'ETIMEDOUT'
  return 'SMTP_SEND_ERROR';
}

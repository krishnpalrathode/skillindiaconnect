export const BOUNCE_HANDLER = 'BOUNCE_HANDLER';

/**
 * A normalized bounce/complaint event — provider-neutral, like the email port.
 * Populated from SES's SNS stream when that adapter lands; unused under Titan.
 */
export interface BounceEvent {
  /** The address that bounced or complained. */
  recipient: string;
  kind: 'BOUNCE' | 'COMPLAINT';
  /** Provider's classification when available (e.g. 'Permanent' / 'Transient'). */
  subType?: string;
  /** The provider message id the bounce refers to, when correlated. */
  providerMessageId?: string;
}

/**
 * THE ONE HONEST ASYMMETRY of the email seam (documented, not hidden).
 *
 * Structured bounce/complaint handling — suppression lists, alerting,
 * transitioning email_messages SENT→BOUNCED — needs a STRUCTURED bounce STREAM.
 * SES has one (SNS notifications). **Titan does NOT**: it returns bounces as a
 * normal email to the sending mailbox, with no machine-readable stream. So
 * under Titan this port is a documented NO-OP, and bounces are handled by a
 * human MONITORING THE MAILBOX (an operational step, noted in
 * docs/cutover-titan-email.md).
 *
 * This is a deliberate DEFERRAL, wired as a seam so SES adds real handling as an
 * ADDITION, not a retrofit: when SesEmailChannel lands, its SNS
 * bounce/complaint subscriber implements this port (suppress + alert) and the
 * webhook that receives SNS calls `onBounce`/`onComplaint`. No email-port change
 * and no caller change — the same seam discipline as the send side.
 */
export interface BounceHandler {
  onBounce(event: BounceEvent): Promise<void>;
  onComplaint(event: BounceEvent): Promise<void>;
}

import { Injectable, Logger } from '@nestjs/common';

/**
 * The Titan binding: a no-op. Titan surfaces bounces only as mailbox email, so
 * there is nothing to consume here — the seam exists so SES can fill it later.
 * It records (redaction-safe) that a call arrived, which only happens if
 * something is wired ahead of the SES adapter — a useful "seam reached early"
 * signal, never a silent swallow.
 */
@Injectable()
export class NoopBounceHandler implements BounceHandler {
  private readonly logger = new Logger(NoopBounceHandler.name);

  async onBounce(event: BounceEvent): Promise<void> {
    this.logger.warn(
      `bounce received but no structured handler is active (Titan MVP; SES pending) — kind=${event.kind}`,
    );
  }

  async onComplaint(event: BounceEvent): Promise<void> {
    this.logger.warn(
      `complaint received but no structured handler is active (Titan MVP; SES pending) — kind=${event.kind}`,
    );
  }
}

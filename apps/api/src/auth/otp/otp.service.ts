import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryStatus, OtpChallenge, OtpPurpose, Prisma, WaMessageKind } from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import {
  WHATSAPP_CHANNEL,
  WhatsappChannel,
  WhatsappSendResult,
} from '../../notifications/channels/whatsapp.channel';

// ─── Constants ────────────────────────────────────────────────────────────────

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const SEND_BUDGET_PHONE = 5; // per hour, SHARED across PHONE_VERIFY + LOGIN
const SEND_BUDGET_IP = 20; // per hour, per IP
const SEND_WINDOW_S = 3600; // 1 hour in seconds

/**
 * What actually happened to an OTP send (CR-WA W1.5).
 *
 *   SENT             the provider accepted it; a code is on its way
 *   NOT_ON_WHATSAPP  the number is confirmed not reachable on WhatsApp
 *   SEND_FAILED      we TRIED and the provider refused or was unreachable
 *
 * SEND_FAILED exists because it used to be indistinguishable from SENT. The
 * three are kept as one discriminated outcome rather than a pair of booleans so
 * a caller cannot accidentally treat "not sent" as "sent" by checking the wrong
 * field — which is exactly how the original bug read.
 *
 * ⚠️ WHETHER AN OUTCOME MAY BE SURFACED DEPENDS ON THE ENDPOINT, not on this
 * type. See otp.controller.ts: the phone-LOGIN endpoint must answer identically
 * regardless, because a send is only attempted there for a REGISTERED number,
 * so any outcome-dependent response would leak account existence.
 */
export type OtpIssueOutcome = 'SENT' | 'NOT_ON_WHATSAPP' | 'SEND_FAILED';

export interface OtpIssueResult {
  outcome: OtpIssueOutcome;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(WHATSAPP_CHANNEL) private readonly whatsapp: WhatsappChannel,
  ) {}

  /**
   * Issue an OTP for the given phone + purpose.
   *
   * Applies the shared per-phone send budget (5/hour across all purposes) and a
   * per-IP budget. On success the raw code is sent via WhatsApp; only its SHA-256
   * hash is persisted — the plaintext is never written to the DB or structured logs.
   */
  async issue(phone: string, purpose: OtpPurpose, ip: string): Promise<OtpIssueResult> {
    await this.checkPhoneBudget(phone);
    await this.applyIpBudget(ip);

    const code = generateCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    // Invalidate any prior unconsumed challenge for (phone, purpose) then create
    // the new one atomically so there is always at most one live challenge.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.otpChallenge.updateMany({
        where: { phone, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.otpChallenge.create({
        data: { phone, purpose, codeHash, expiresAt, attempts: 0 },
      });
    });

    /**
     * DEFENSIVE CATCH (CR-WA W1) — a guarantee, not a request.
     *
     * The channel contract is that a send NEVER throws: every failure comes back
     * as `ok:false` (see meta-whatsapp.channel.ts, which proves it across every
     * rejection path). That contract is well-tested — but this is the AUTH PATH,
     * and it is the one place where the OTP exception in
     * worker-and-external-sends.md puts a single class's discipline between a
     * user and their account. Elsewhere a thrown adapter error costs a retried
     * background job; here it costs a 500 on the login screen, and a user who
     * cannot get in has no workaround.
     *
     * So the guarantee lives here rather than resting on the adapter's good
     * behaviour: a throw is folded into the SAME `ok:false` handling below, and
     * the delivery row is written FAILED like any other failed send.
     */
    let result: WhatsappSendResult;
    try {
      result = await this.whatsapp.sendOtp(phone, code, purpose as 'PHONE_VERIFY' | 'LOGIN');
    } catch (err) {
      // No phone, no code — the redaction rule applies to logs.
      this.logger.error(
        'WhatsApp OTP adapter THREW, violating its no-throw contract; treating as a ' +
          `failed send: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
      result = { ok: false, errorCode: 'ADAPTER_THREW' };
    }

    if (result.notOnWhatsapp) {
      return { outcome: 'NOT_ON_WHATSAPP' };
    }

    // Persist a delivery-tracking row (kind=OTP) so OTP sends are traceable like
    // every other WhatsApp message. userId is unknown here (send is phone-only).
    // The messages table legitimately stores the phone — the no-PII rule applies
    // to logs/audit/Sentry, not the delivery ledger itself.
    await this.prisma.whatsappMessage.create({
      data: {
        phone,
        kind: WaMessageKind.OTP,
        templateName: 'wa.otp',
        waMessageId: result.providerMessageId ?? null,
        status: result.ok ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
        statusUpdatedAt: new Date(),
      },
    });

    /**
     * The send either happened or it did not — and the caller is told which.
     *
     * This previously returned `{ sent: true }` for EVERY non-notOnWhatsapp
     * outcome, including outright failures. The delivery row said FAILED while
     * the API said "sent", so during a provider outage a user was shown "code
     * sent", waited for a code that was never dispatched, and had no way
     * forward. On the login path that is a lockout, and it contradicts
     * worker-and-external-sends.md's "never silently claim a notification was
     * delivered".
     */
    return { outcome: result.ok ? 'SENT' : 'SEND_FAILED' };
  }

  /**
   * Verify an OTP code against the latest unconsumed challenge for (phone, purpose).
   *
   * Purpose is enforced by the query — a PHONE_VERIFY code cannot satisfy a LOGIN
   * verify and vice versa.
   */
  async verify(
    phone: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<{ challenge: OtpChallenge }> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'INVALID_OTP' });
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException({ code: 'INVALID_OTP' });
    }

    const valid = hashCode(otp) === challenge.codeHash;

    if (!valid) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException({ code: 'INVALID_OTP' });
    }

    const consumed = await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    return { challenge: consumed };
  }

  /**
   * Increment the per-IP send budget without touching the per-phone counter.
   * Called by the phone-login start endpoint for unknown phones so the IP can't
   * be hammered to enumerate registrations by timing.
   */
  async applyIpBudget(ip: string): Promise<void> {
    const key = `otp:send:ip:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, SEND_WINDOW_S);
    }
    if (count > SEND_BUDGET_IP) {
      throw new HttpException({ code: 'OTP_RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async checkPhoneBudget(phone: string): Promise<void> {
    const key = `otp:send:phone:${phone}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, SEND_WINDOW_S);
    }
    if (count > SEND_BUDGET_PHONE) {
      throw new HttpException({ code: 'OTP_RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

// ─── Helpers (module-private) ─────────────────────────────────────────────────

function generateCode(): string {
  return String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OtpChallenge, OtpPurpose, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { WHATSAPP_CHANNEL, WhatsappChannel } from '../../notifications/channels/whatsapp.channel';

// ─── Constants ────────────────────────────────────────────────────────────────

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const SEND_BUDGET_PHONE = 5; // per hour, SHARED across PHONE_VERIFY + LOGIN
const SEND_BUDGET_IP = 20; // per hour, per IP
const SEND_WINDOW_S = 3600; // 1 hour in seconds

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class OtpService {
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
  async issue(
    phone: string,
    purpose: OtpPurpose,
    ip: string,
  ): Promise<{ sent: boolean; notOnWhatsapp?: boolean }> {
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

    const result = await this.whatsapp.sendOtp(phone, code, purpose as 'PHONE_VERIFY' | 'LOGIN');
    if (result.notOnWhatsapp) {
      return { sent: false, notOnWhatsapp: true };
    }

    return { sent: true };
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

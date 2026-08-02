import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NotificationType, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { NotificationService } from '../notifications/notification.service';
import { PasswordService } from './password.service';

// ─── Constants ────────────────────────────────────────────────────────────────

/** 32 random bytes → 64 hex chars. Far beyond guessing range for a live window. */
const TOKEN_BYTES = 32;
/** Short-lived by design: a mail-borne bearer credential, not a session. */
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const SEND_BUDGET_EMAIL = 5; // per hour, per address
const SEND_WINDOW_S = 3600;

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Password reset — issue a mailed link, then consume it.
 *
 * ENUMERATION SAFETY is the governing constraint on `request()`: it returns void
 * on EVERY path — unknown address, Google-only account, suspended account — so
 * neither the status code, the body, nor the presence of an email reveals
 * whether an address is registered. The controller therefore always answers 200.
 *
 * WORKER-ONLY SEND: this enqueues through NotificationService. The API process
 * never talks to the email provider (worker-and-external-sends.md).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly notifications: NotificationService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Issue a reset link for `email`, if it resolves to a password account.
   *
   * Only the token's SHA-256 is stored; the raw value exists solely inside the
   * emailed URL. Any earlier unconsumed token for the user is invalidated first,
   * so requesting a second link silently retires the first — a link that leaked
   * cannot be revived by the attacker simply waiting.
   */
  async request(email: string, ip?: string): Promise<void> {
    await this.applyEmailBudget(email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, status: true },
    });

    // Unknown address — do nothing, but the caller still gets 200.
    if (!user) return;

    // Google-only account: there is no password to reset. Telling them so is
    // both more useful than silence and safe — only the mailbox owner sees it.
    if (!user.passwordHash) {
      await this.notifications.notify(user.id, NotificationType.PASSWORD_RESET, {
        title: 'Sign in with Google',
        body: 'This account uses Google sign-in, so it has no password to reset.',
        data: {
          subject: 'SkillIndiaConnect — sign in with Google',
          text:
            'You asked to reset the password for your SkillIndiaConnect account, ' +
            'but this account signs in with Google and has no password.\n\n' +
            'Use "Continue with Google" on the sign-in page.\n\n' +
            'If you did not request this, you can ignore this email.',
        },
      });
      return;
    }

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });

    const url = `${this.configService.get<string>('WEB_APP_URL')}/reset-password?token=${token}`;

    await this.notifications.notify(user.id, NotificationType.PASSWORD_RESET, {
      title: 'Reset your password',
      body: 'Use the link in this email to choose a new password.',
      data: {
        subject: 'SkillIndiaConnect — reset your password',
        text:
          'Someone asked to reset the password for your SkillIndiaConnect account.\n\n' +
          `Open this link to choose a new one (valid for 1 hour):\n${url}\n\n` +
          'If you did not request this, ignore this email — your password will not change.',
        html:
          '<p>Someone asked to reset the password for your SkillIndiaConnect account.</p>' +
          `<p><a href="${url}">Choose a new password</a> — this link is valid for 1 hour.</p>` +
          '<p>If you did not request this, ignore this email — your password will not change.</p>',
      },
    });

    // No-PII rule: the address and the token never reach the logs.
    this.logger.log(`password reset link issued userId=${user.id} ip=${ip ?? 'unknown'}`);
  }

  /**
   * Consume a reset token and set the new password.
   *
   * Everything happens in ONE transaction that also marks the token consumed, so
   * two concurrent submissions of the same link cannot both succeed.
   *
   * All refresh sessions are revoked: a reset is the standard response to a
   * suspected compromise, and leaving the attacker's existing session alive
   * would defeat the point.
   */
  async reset(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true, consumedAt: true, tokenHash: true },
    });

    // One shared failure code: a caller must not learn WHICH of these it hit,
    // or a forged token becomes distinguishable from an expired real one.
    if (
      !record ||
      record.consumedAt !== null ||
      record.expiresAt < new Date() ||
      !constantTimeEquals(record.tokenHash, hashToken(token))
    ) {
      throw new HttpException({ code: 'INVALID_RESET_TOKEN' }, HttpStatus.BAD_REQUEST);
    }

    const passwordHash = await this.passwordService.hashPassword(newPassword);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Guarded UPDATE: consumedAt must STILL be null. If a concurrent request
      // consumed it first this matches zero rows and we abort — the check above
      // alone would be a TOCTOU race.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new HttpException({ code: 'INVALID_RESET_TOKEN' }, HttpStatus.BAD_REQUEST);
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      await tx.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    this.logger.log(`password reset completed userId=${record.userId}`);
  }

  /**
   * Per-address send budget. Keyed on the address rather than the account so an
   * UNKNOWN address is rate-limited identically — otherwise the differing
   * response timing between throttled and non-throttled addresses would itself
   * be an enumeration oracle.
   */
  private async applyEmailBudget(email: string): Promise<void> {
    const key = `pwreset:send:email:${email.toLowerCase()}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, SEND_WINDOW_S);
    }
    if (count > SEND_BUDGET_EMAIL) {
      throw new HttpException({ code: 'RATE_LIMIT_EXCEEDED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

// ─── Helpers (module-private) ─────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compare two equal-length hex digests without leaking position via timing. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

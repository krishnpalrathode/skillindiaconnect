import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
// A shared CONSTANT, not a cross-module service call — auth still owns the
// `users` row it writes here; it only borrows the threshold the candidate
// activity buckets are defined against, so the two cannot drift.
import { ACTIVITY_WRITE_THROTTLE_HOURS } from '../candidate/activity.constants';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExp: number; // Unix seconds — tells the controller how long to set the cookie
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti: string;
  type: 'access';
  exp: number;
  iat: number;
}

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  exp: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(
    userId: string,
    email: string,
    role: UserRole,
    ip?: string,
    userAgent?: string,
  ): Promise<IssuedTokens> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET')!;
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET')!;
    const accessTtl = this.configService.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.configService.get<string>('JWT_REFRESH_TTL') ?? '30d';

    const accessJti = randomUUID();
    const sessionId = randomUUID(); // becomes refresh token jti

    // email is included so the frontend can reconstruct UserSummary from the
    // access token alone on silent refresh (no user object in the refresh
    // response) — see apps/web/src/lib/auth/auth-context.tsx's decodeToken().
    const accessToken = this.jwtService.sign(
      { sub: userId, email, role, jti: accessJti, type: 'access' },
      { secret: accessSecret, expiresIn: accessTtl },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, jti: sessionId, type: 'refresh' },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );

    const { exp: refreshExp } = this.jwtService.decode(refreshToken) as RefreshTokenPayload;

    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: hashToken(refreshToken),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        expiresAt: new Date(refreshExp * 1000),
      },
    });

    return { accessToken, refreshToken, refreshExp };
  }

  async rotate(refreshToken: string, ip?: string, userAgent?: string): Promise<IssuedTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.jti },
    });

    if (!session) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    if (session.tokenHash !== hashToken(refreshToken)) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    // REUSE ATTACK: token was already revoked — revoke the entire session family.
    if (session.revokedAt) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      console.error(
        `[Auth] TOKEN_REUSE detected — all sessions revoked for user ${session.userId}`,
      );
      throw new UnauthorizedException({ code: 'TOKEN_REUSE' });
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    // Revoke the consumed session and issue a fresh pair.
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    // S6b-B1: suspension must actually lock the account, not just block fresh
    // logins — without this, a live refresh token keeps minting access tokens
    // for a suspended user. Mirrors the login-time gate (same code).
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED' });
    }

    /*
      Refreshing counts as being seen.

      `lastLoginAt` drives the candidate activity buckets employers browse by
      and the 30-day "are you still looking?" email. Written only at LOGIN it
      would mean the opposite of what it says: somebody who opens the app every
      morning on a phone that never signs them out could go months without a
      login event and be reported to employers as inactive, then emailed asking
      if they are still looking. That is the exact user this feature must not
      insult.

      THROTTLED, because a refresh happens every few minutes for an open app and
      this value is measured in days — one write per half-day keeps the field
      accurate to well inside the smallest bucket while keeping the auth hot
      path read-mostly. Fire-and-forget for the same reason: a failed activity
      write must never cost the user their session.
    */
    const staleBefore = new Date(Date.now() - ACTIVITY_WRITE_THROTTLE_HOURS * 60 * 60 * 1000);
    if (!user.lastLoginAt || user.lastLoginAt < staleBefore) {
      await this.prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
    }

    return this.issue(user.id, user.email, user.role, ip, userAgent);
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.type !== 'refresh') return;
      await this.prisma.refreshSession.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Invalid token on logout — silently discard.
    }
  }

  async blacklistAccessJti(jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.setex(`blacklist:access:${jti}`, ttlSeconds, '1');
  }

  /**
   * Is this access token revoked (logged out)?
   *
   * CHAOS-003 (S8-H3) — THIS ONE FAILS CLOSED ON PURPOSE, and unlike the
   * permission cache it CANNOT degrade to the database.
   *
   * The revocation list lives only in Redis: there is no other record that a
   * given jti was logged out. So when Redis is unreachable there are exactly
   * two choices, and they are not close:
   *
   *   - fail OPEN  → every logged-out token silently works again for the
   *                  duration of the outage. Logout would stop meaning logout
   *                  precisely when the platform is least healthy.
   *   - fail CLOSED → authenticated requests are refused until Redis returns.
   *
   * Fail closed is the only defensible answer for a revocation check, so the
   * throw is deliberate. What changed here is HONESTY, not the outcome: the
   * unguarded `exists()` used to surface as `500 INTERNAL_ERROR`, which reads
   * as "the API has a bug" and pages the wrong people. It is now an explicit
   * `503 SESSION_VERIFICATION_UNAVAILABLE` — the accurate statement that we
   * cannot verify the session right now, retriable, and routed to whoever owns
   * the cache rather than whoever owns the code.
   *
   * Operational consequence, stated plainly: a Redis outage makes the
   * AUTHENTICATED API unavailable while public routes keep serving. That is a
   * real availability dependency and it is documented in the runbook as such,
   * with removing it (a signed short-TTL revocation scheme, or a DB-backed
   * revocation table) recorded as the follow-up.
   */
  async isAccessJtiBlacklisted(jti: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(`blacklist:access:${jti}`);
      return result === 1;
    } catch (err) {
      this.logger.error(
        `session revocation check unavailable — failing CLOSED: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException({ code: 'SESSION_VERIFICATION_UNAVAILABLE' });
    }
  }

  /** Exposed for AuthGuard to verify an access token. */
  verifyAccess(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }
}

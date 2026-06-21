import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExp: number; // Unix seconds — tells the controller how long to set the cookie
}

interface AccessTokenPayload {
  sub: string;
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
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(
    userId: string,
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

    const accessToken = this.jwtService.sign(
      { sub: userId, role, jti: accessJti, type: 'access' },
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
    return this.issue(user.id, user.role, ip, userAgent);
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

  async isAccessJtiBlacklisted(jti: string): Promise<boolean> {
    const result = await this.redis.exists(`blacklist:access:${jti}`);
    return result === 1;
  }

  /** Exposed for AuthGuard to verify an access token. */
  verifyAccess(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }
}

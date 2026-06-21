import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TokenService } from './token.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { UserRole } from '@prisma/client';

const USER_ID = 'user-uuid-1';
const ROLE = UserRole.CANDIDATE;

function makeConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JWT_ACCESS_SECRET: 'access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'refresh-secret-at-least-32-characters-long',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    ...overrides,
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;
  let prismaMock: jest.Mocked<Pick<PrismaService, 'refreshSession' | 'user'>>;
  let redisMock: { setex: jest.Mock; exists: jest.Mock };

  beforeEach(async () => {
    const config = makeConfig();

    prismaMock = {
      refreshSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      } as unknown as jest.Mocked<PrismaService['refreshSession']>,
      user: {
        findUniqueOrThrow: jest.fn(),
      } as unknown as jest.Mocked<PrismaService['user']>,
    };

    redisMock = { setex: jest.fn().mockResolvedValue('OK'), exists: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get(TokenService);
    jwtService = module.get(JwtService);
  });

  describe('issue', () => {
    it('returns access + refresh tokens and persists a session', async () => {
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});
      const result = await service.issue(USER_ID, ROLE, '127.0.0.1', 'jest');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.refreshExp).toBeGreaterThan(Date.now() / 1000);
      expect(prismaMock.refreshSession.create).toHaveBeenCalledTimes(1);
    });

    it('access token contains sub, role, jti, type=access', () => {
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});
      return service.issue(USER_ID, ROLE).then(({ accessToken }) => {
        const decoded = jwtService.decode(accessToken) as Record<string, unknown>;
        expect(decoded['sub']).toBe(USER_ID);
        expect(decoded['role']).toBe(ROLE);
        expect(decoded['type']).toBe('access');
        expect(typeof decoded['jti']).toBe('string');
      });
    });
  });

  describe('rotate', () => {
    it('revokes old session and issues a new token pair', async () => {
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});
      const { refreshToken } = await service.issue(USER_ID, ROLE);
      const sessionId = (prismaMock.refreshSession.create as jest.Mock).mock.calls[0]![0].data
        .id as string;

      const session = {
        id: sessionId,
        userId: USER_ID,
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      (prismaMock.refreshSession.findUnique as jest.Mock).mockResolvedValue(session);
      (prismaMock.refreshSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: USER_ID,
        role: ROLE,
      });
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});

      const result = await service.rotate(refreshToken);
      expect(result.accessToken).toBeTruthy();
      expect(prismaMock.refreshSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: sessionId } }),
      );
    });

    it('throws TOKEN_REUSE and revokes ALL sessions when replaying a revoked token', async () => {
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});
      const { refreshToken } = await service.issue(USER_ID, ROLE);
      const sessionId = (prismaMock.refreshSession.create as jest.Mock).mock.calls[0]![0].data
        .id as string;

      const session = {
        id: sessionId,
        userId: USER_ID,
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        revokedAt: new Date(), // already revoked
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      (prismaMock.refreshSession.findUnique as jest.Mock).mockResolvedValue(session);
      (prismaMock.refreshSession.updateMany as jest.Mock).mockResolvedValue({});

      await expect(service.rotate(refreshToken)).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID, revokedAt: null } }),
      );
    });

    it('throws INVALID_REFRESH for an unknown session', async () => {
      (prismaMock.refreshSession.create as jest.Mock).mockResolvedValue({});
      const { refreshToken } = await service.issue(USER_ID, ROLE);
      (prismaMock.refreshSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.rotate(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('blacklist', () => {
    it('sets a Redis key and detects it', async () => {
      redisMock.exists.mockResolvedValue(1);
      await service.blacklistAccessJti('jti-xyz', 300);
      expect(redisMock.setex).toHaveBeenCalledWith('blacklist:access:jti-xyz', 300, '1');
      await expect(service.isAccessJtiBlacklisted('jti-xyz')).resolves.toBe(true);
    });

    it('returns false for a non-blacklisted jti', async () => {
      redisMock.exists.mockResolvedValue(0);
      await expect(service.isAccessJtiBlacklisted('not-there')).resolves.toBe(false);
    });
  });
});

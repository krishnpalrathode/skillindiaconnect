import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './guards/auth.guard';
import { TokenService } from './token.service';
import { UserRole } from '@prisma/client';

function makeContext(
  overrides: {
    authHeader?: string;
    isPublic?: boolean;
    user?: unknown;
  } = {},
): ExecutionContext {
  const request = {
    headers: { authorization: overrides.authHeader ?? '' },
    user: overrides.user ?? undefined,
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let tokenService: {
    verifyAccess: jest.Mock;
    isAccessJtiBlacklisted: jest.Mock;
  };

  const validPayload = {
    sub: 'u1',
    role: UserRole.CANDIDATE,
    jti: 'jti-abc',
    type: 'access' as const,
    exp: Math.floor(Date.now() / 1000) + 900,
    iat: Math.floor(Date.now() / 1000),
  };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    tokenService = {
      verifyAccess: jest.fn().mockReturnValue(validPayload),
      isAccessJtiBlacklisted: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: reflector },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
  });

  it('allows a request with a valid Bearer token', async () => {
    const ctx = makeContext({ authHeader: 'Bearer valid.jwt.token' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('attaches userId/role/jti/exp to req.user', async () => {
    const req = { headers: { authorization: 'Bearer t' }, user: undefined };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);
    expect((req as typeof req & { user: unknown }).user).toMatchObject({
      userId: 'u1',
      role: UserRole.CANDIDATE,
      jti: 'jti-abc',
    });
  });

  it('throws 401 when no Authorization header', async () => {
    const ctx = makeContext({ authHeader: '' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when token fails verification', async () => {
    tokenService.verifyAccess.mockImplementation(() => {
      throw new Error('expired');
    });
    const ctx = makeContext({ authHeader: 'Bearer bad.token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when access jti is blacklisted', async () => {
    tokenService.isAccessJtiBlacklisted.mockResolvedValue(true);
    const ctx = makeContext({ authHeader: 'Bearer valid.jwt.token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('allows a @Public() route without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true); // @Public()
    const ctx = makeContext({ authHeader: '' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

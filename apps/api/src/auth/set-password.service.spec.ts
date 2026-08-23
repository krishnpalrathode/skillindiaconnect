import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PrismaService } from '../core/prisma/prisma.service';

/**
 * Setting the FIRST password on a phone-signup account.
 *
 * This endpoint takes no current password — the access token is the only
 * proof — which is safe exactly as long as it can never overwrite a credential
 * that already exists. If it could, a stolen access token would be enough to
 * change someone's password and lock them out of their own account. Every test
 * below is about that boundary.
 */
describe('AuthService.setPassword', () => {
  let service: AuthService;
  let prismaMock: {
    user: { findUniqueOrThrow: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ passwordHash: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PasswordService, useValue: { hashPassword: jest.fn(async () => 'hashed') } },
        { provide: TokenService, useValue: { issue: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'development' } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('stores a hash on an account that has none — never the plaintext', async () => {
    await service.setPassword('user-1', 'Password123!');

    const [[args]] = prismaMock.user.updateMany.mock.calls;
    expect(args.data.passwordHash).toBe('hashed');
    expect(JSON.stringify(args)).not.toContain('Password123!');
  });

  it('refuses to overwrite an existing password', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ passwordHash: 'already-here' });
    await expect(service.setPassword('user-1', 'Password123!')).rejects.toThrow(ConflictException);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  /**
   * A Google-only account has a credential already, so this is not its path —
   * same rule, same reason as an account with a password.
   */
  it('refuses a Google-linked account that already has a password', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ passwordHash: 'google-set' });
    await expect(service.setPassword('user-1', 'Password123!')).rejects.toThrow(ConflictException);
  });

  /**
   * Two concurrent requests both read `passwordHash: null` and both pass the
   * check. The write is guarded on the column still being null, so the loser
   * updates zero rows — and must be told, not silently reported as success
   * with a password it did not set.
   */
  it('loses the race safely — a guarded write that matched nothing is a conflict', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.setPassword('user-1', 'Password123!')).rejects.toThrow(ConflictException);
  });

  it('scopes the write to the caller and to the null-password precondition', async () => {
    await service.setPassword('user-1', 'Password123!');
    const [[args]] = prismaMock.user.updateMany.mock.calls;
    expect(args.where).toEqual({ id: 'user-1', passwordHash: null });
  });
});

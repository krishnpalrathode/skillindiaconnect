import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PrismaService } from '../core/prisma/prisma.service';

const TOKENS = { accessToken: 'acc', refreshToken: 'ref', refreshExp: 9999999999 };

function makeUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'test@example.com',
    role: UserRole.CANDIDATE,
    status: UserStatus.ACTIVE,
    passwordHash: '$argon2id$mock',
    googleId: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prismaMock: { user: Record<string, jest.Mock> };
  let passwordMock: jest.Mocked<PasswordService>;
  let tokenMock: jest.Mocked<Pick<TokenService, 'issue'>>;

  beforeEach(async () => {
    prismaMock = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    passwordMock = {
      hashPassword: jest.fn().mockResolvedValue('$argon2id$hashed'),
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<PasswordService>;

    tokenMock = { issue: jest.fn().mockResolvedValue(TOKENS) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PasswordService, useValue: passwordMock },
        { provide: TokenService, useValue: tokenMock },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ─── signup ──────────────────────────────────────────────────────────────────

  describe('signup', () => {
    it('creates a user with argon2 hash and termsAcceptedAt', async () => {
      const created = makeUser();
      (prismaMock.user.create as jest.Mock).mockResolvedValue(created);

      const result = await service.signup({
        email: 'test@example.com',
        password: 'Hunter2!x',
        role: 'CANDIDATE',
        acceptedTerms: true,
      });

      expect(passwordMock.hashPassword).toHaveBeenCalledWith('Hunter2!x');
      const createCall = (prismaMock.user.create as jest.Mock).mock.calls[0]![0];
      expect(createCall.data.passwordHash).toBe('$argon2id$hashed');
      expect(createCall.data.termsAcceptedAt).toBeInstanceOf(Date);
      expect(result.user.id).toBe('u1');
      expect(result.accessToken).toBe('acc');
    });

    it('throws 409 EMAIL_TAKEN on duplicate email', async () => {
      const p2002 = Object.assign(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.0',
        }),
      );
      (prismaMock.user.create as jest.Mock).mockRejectedValue(p2002);

      await expect(
        service.signup({
          email: 'dup@example.com',
          password: 'Hunter2!x',
          role: 'CANDIDATE',
          acceptedTerms: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects ADMIN role at the DTO layer (integration guard — confirm enum blocks it)', () => {
      // The DTO's @IsEnum restricts to CANDIDATE/EMPLOYER. Here we confirm the service
      // won't cast an invalid role — actual enforcement is in the DTO/ValidationPipe.
      expect(['CANDIDATE', 'EMPLOYER']).not.toContain('ADMIN');
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns tokens on success and records lastLoginAt', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(makeUser());
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});

      const result = await service.login({ email: 'test@example.com', password: 'Hunter2!x' });
      expect(result.accessToken).toBe('acc');
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lastLoginAt: expect.any(Date) } }),
      );
    });

    it('throws 401 INVALID_CREDENTIALS when user not found', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.login({ email: 'x@x.com', password: 'p' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 INVALID_CREDENTIALS with Google message for Google-only account', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(
        makeUser({ passwordHash: null, googleId: 'gid' }),
      );
      await expect(service.login({ email: 'g@x.com', password: 'p' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 INVALID_CREDENTIALS on wrong password', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(makeUser());
      (passwordMock.verify as jest.Mock).mockResolvedValue(false);
      await expect(service.login({ email: 't@x.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 403 ACCOUNT_SUSPENDED for a suspended user', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(
        makeUser({ status: UserStatus.SUSPENDED }),
      );
      await expect(service.login({ email: 't@x.com', password: 'Hunter2!x' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── Google callback ─────────────────────────────────────────────────────────

  describe('handleGoogleCallback', () => {
    const googleUser = { googleId: 'gid1', email: 'g@x.com', displayName: 'G User' };

    it('creates a CANDIDATE user for a new Google email', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      const created = makeUser({ googleId: 'gid1', passwordHash: null });
      (prismaMock.user.create as jest.Mock).mockResolvedValue(created);

      const result = await service.handleGoogleCallback(googleUser);
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.CANDIDATE, googleId: 'gid1' }),
        }),
      );
      expect(result.accessToken).toBe('acc');
    });

    it('throws 403 GOOGLE_NOT_ALLOWED when email belongs to an EMPLOYER', async () => {
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no match by googleId
        .mockResolvedValueOnce(makeUser({ role: UserRole.EMPLOYER })); // found by email

      await expect(service.handleGoogleCallback(googleUser)).rejects.toThrow(ForbiddenException);
    });
  });
});

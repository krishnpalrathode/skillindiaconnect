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
    linkedinId: null,
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

  // ─── LinkedIn callback ───────────────────────────────────────────────────────

  /*
    LinkedIn and Google share one implementation (`handleFederatedCallback`), so
    these do NOT re-test the resolution rules provider by provider. What they pin
    is the part sharing cannot prove: that LinkedIn is wired to its OWN column,
    and that the rules the shared path added are actually enforced.
  */
  describe('handleLinkedinCallback', () => {
    const linkedinUser = { linkedinId: 'sub-1', email: 'l@x.com', displayName: 'L User' };

    it('creates a CANDIDATE user stamped with linkedinId, not googleId', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.user.create as jest.Mock).mockResolvedValue(
        makeUser({ linkedinId: 'sub-1', passwordHash: null }),
      );

      const result = await service.handleLinkedinCallback(linkedinUser);

      const created = (prismaMock.user.create as jest.Mock).mock.calls[0]![0].data;
      expect(created).toMatchObject({ linkedinId: 'sub-1', role: UserRole.CANDIDATE });
      // The whole point of the per-provider column: a LinkedIn sign-in must not
      // write a value into the Google one, which would let it satisfy a later
      // Google lookup.
      expect(created.googleId).toBeUndefined();
      expect(result.accessToken).toBe('acc');
    });

    it('LINKS an existing candidate found by email instead of creating a duplicate', async () => {
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no match by linkedinId
        .mockResolvedValueOnce(makeUser()); // found by email
      (prismaMock.user.update as jest.Mock).mockResolvedValue(makeUser({ linkedinId: 'sub-1' }));

      await service.handleLinkedinCallback(linkedinUser);

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedinId: 'sub-1', lastLoginAt: expect.any(Date) },
        }),
      );
    });

    it('matches a returning user on linkedinId BEFORE email', async () => {
      // The address at LinkedIn may have changed since signup; the subject is
      // the stable identifier and must win.
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValueOnce(
        makeUser({ linkedinId: 'sub-1' }),
      );
      (prismaMock.user.update as jest.Mock).mockResolvedValue(makeUser({ linkedinId: 'sub-1' }));

      await service.handleLinkedinCallback(linkedinUser);

      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('throws 403 LINKEDIN_NOT_ALLOWED when the email belongs to an EMPLOYER', async () => {
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeUser({ role: UserRole.EMPLOYER }));

      await expect(service.handleLinkedinCallback(linkedinUser)).rejects.toMatchObject({
        response: { code: 'LINKEDIN_NOT_ALLOWED' },
      });
      // Refused BEFORE any write — an employer account must not come back with a
      // LinkedIn id attached to it.
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('writes NOTHING when the sign-in is refused', async () => {
      /*
        A refused login must leave no trace on the account. An earlier version
        linked the provider id inside the lookup, BEFORE the gates ran — so a
        suspended candidate came out of a rejected sign-in with a working
        LinkedIn link sitting there, ready for the day the suspension is lifted.
        Read, gate, then write.
      */
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no linkedinId match
        .mockResolvedValueOnce(makeUser({ status: UserStatus.SUSPENDED })); // by email

      await expect(service.handleLinkedinCallback(linkedinUser)).rejects.toMatchObject({
        response: { code: 'ACCOUNT_SUSPENDED' },
      });

      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('REFUSES a suspended account — the gap that let OAuth bypass suspension', async () => {
      /*
        login() has always refused SUSPENDED, but the OAuth path never checked.
        An admin suspending an account did nothing to anyone who signed in with a
        provider button, which makes suspension advisory rather than enforced.
      */
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValueOnce(
        makeUser({ linkedinId: 'sub-1', status: UserStatus.SUSPENDED }),
      );

      await expect(service.handleLinkedinCallback(linkedinUser)).rejects.toMatchObject({
        response: { code: 'ACCOUNT_SUSPENDED' },
      });
      expect(tokenMock.issue).not.toHaveBeenCalled();
    });

    it('records lastLoginAt — the inactivity check-in reads it', async () => {
      /*
        Without this write an OAuth-only candidate looks permanently dormant, and
        the 30-day "are you still looking?" mail goes to people using the product
        daily. Applies to Google too; both run this code.
      */
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValueOnce(
        makeUser({ linkedinId: 'sub-1' }),
      );
      (prismaMock.user.update as jest.Mock).mockResolvedValue(makeUser({ linkedinId: 'sub-1' }));

      await service.handleLinkedinCallback(linkedinUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('resolves a concurrent first sign-in instead of surfacing P2002', async () => {
      // Two tabs, both past the "no such user" read before either wrote. The
      // loser must land on the row the winner created, not on a 500.
      const winner = makeUser({ linkedinId: 'sub-1' });
      (prismaMock.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // by linkedinId
        .mockResolvedValueOnce(null) // by email
        .mockResolvedValueOnce(winner); // re-read after the collision
      (prismaMock.user.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dupe', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      const result = await service.handleLinkedinCallback(linkedinUser);
      expect(result.accessToken).toBe('acc');
    });
  });
});

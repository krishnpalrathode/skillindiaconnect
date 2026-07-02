import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserRole, UserStatus } from '@prisma/client';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CandidateReadService } from '../../candidate/candidate-read.service';

const TOKENS = { accessToken: 'acc-token', refreshToken: 'ref-token', refreshExp: 9999999999 };

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'candidate@example.com',
    role: UserRole.CANDIDATE,
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    userId: 'user-1',
    phone: '+911234567890',
    phoneVerifiedAt: new Date(),
    user: makeUser(),
    ...overrides,
  };
}

// Minimal mock response (passthrough cookie setter)
function makeRes() {
  return { cookie: jest.fn() } as unknown as import('express').Response;
}

describe('OtpController', () => {
  let controller: OtpController;
  let otpMock: jest.Mocked<Pick<OtpService, 'issue' | 'verify' | 'applyIpBudget'>>;
  let prismaMock: {
    candidateProfile: { findFirst: jest.Mock; update: jest.Mock };
    user: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
  };
  let candidateReadMock: jest.Mocked<Pick<CandidateReadService, 'findCandidateUserByVerifiedPhone'>>;
  let tokenMock: jest.Mocked<Pick<TokenService, 'issue'>>;

  const mockReq = { ip: '1.2.3.4', headers: {} } as unknown as import('express').Request;

  beforeEach(async () => {
    otpMock = {
      issue: jest.fn().mockResolvedValue({ sent: true }),
      verify: jest.fn().mockResolvedValue({ challenge: {} }),
      applyIpBudget: jest.fn().mockResolvedValue(undefined),
    };

    prismaMock = {
      candidateProfile: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(makeUser()),
      },
    };

    candidateReadMock = {
      findCandidateUserByVerifiedPhone: jest.fn(),
    };

    tokenMock = { issue: jest.fn().mockResolvedValue(TOKENS) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: otpMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: TokenService, useValue: tokenMock },
        { provide: ConfigService, useValue: { get: () => 'development' } },
        { provide: CandidateReadService, useValue: candidateReadMock },
      ],
    }).compile();

    controller = module.get(OtpController);
  });

  // ─── POST /auth/otp/send ─────────────────────────────────────────────────

  describe('sendOtp', () => {
    it('returns 200 { data: { sent: true } } on success', async () => {
      otpMock.issue.mockResolvedValue({ sent: true });
      const result = await controller.sendOtp({ phone: '+911234567890' }, mockReq);
      expect(result).toEqual({ data: { sent: true } });
      expect(otpMock.issue).toHaveBeenCalledWith(
        '+911234567890',
        OtpPurpose.PHONE_VERIFY,
        '1.2.3.4',
      );
    });

    it('throws 409 PHONE_NOT_ON_WHATSAPP when channel returns notOnWhatsapp', async () => {
      otpMock.issue.mockResolvedValue({ sent: false, notOnWhatsapp: true });
      await expect(controller.sendOtp({ phone: '+910000' }, mockReq)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── POST /auth/otp/verify ───────────────────────────────────────────────

  describe('verifyOtp', () => {
    const currentUser = {
      userId: 'user-1',
      role: UserRole.CANDIDATE,
      jti: 'jti-abc',
      exp: 9999999999,
    };

    it('sets phoneVerifiedAt + whatsappCapable on success', async () => {
      prismaMock.candidateProfile.findFirst.mockResolvedValue(null); // no conflict

      const result = await controller.verifyOtp(
        { phone: '+911234567890', otp: '123456' },
        currentUser,
      );

      expect(result).toEqual({ data: { phoneVerified: true, whatsappCapable: true } });
      expect(prismaMock.candidateProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({
            phone: '+911234567890',
            phoneVerifiedAt: expect.any(Date),
            whatsappCapable: true,
          }),
        }),
      );
    });

    it('throws 401 INVALID_OTP when OtpService.verify throws', async () => {
      otpMock.verify.mockRejectedValue(new UnauthorizedException({ code: 'INVALID_OTP' }));
      await expect(
        controller.verifyOtp({ phone: '+911234567890', otp: '000000' }, currentUser),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 409 PHONE_ALREADY_IN_USE when phone is claimed by another candidate', async () => {
      prismaMock.candidateProfile.findFirst.mockResolvedValue(
        makeProfile({ userId: 'other-user' }),
      );
      await expect(
        controller.verifyOtp({ phone: '+911234567890', otp: '123456' }, currentUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── POST /auth/login/phone/start ────────────────────────────────────────

  describe('phoneLoginStart', () => {
    it('always returns 200 for a registered verified candidate', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'user-1',
        candidateId: 'profile-1',
      });
      otpMock.issue.mockResolvedValue({ sent: true });

      const result = await controller.phoneLoginStart({ phone: '+911234567890' }, mockReq);
      expect(result).toEqual({
        data: { message: 'If an account exists, an OTP has been sent.' },
      });
      expect(otpMock.issue).toHaveBeenCalledWith('+911234567890', OtpPurpose.LOGIN, '1.2.3.4');
    });

    it('always returns 200 for an unknown phone — applies IP budget only', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue(null);

      const result = await controller.phoneLoginStart({ phone: '+910000000000' }, mockReq);
      expect(result).toEqual({
        data: { message: 'If an account exists, an OTP has been sent.' },
      });
      expect(otpMock.issue).not.toHaveBeenCalled();
      expect(otpMock.applyIpBudget).toHaveBeenCalledWith('1.2.3.4');
    });

    it('always returns 200 even when notOnWhatsapp (result swallowed)', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'user-1',
        candidateId: 'profile-1',
      });
      otpMock.issue.mockResolvedValue({ sent: false, notOnWhatsapp: true });

      const result = await controller.phoneLoginStart({ phone: '+910000' }, mockReq);
      expect(result).toEqual({
        data: { message: 'If an account exists, an OTP has been sent.' },
      });
    });
  });

  // ─── POST /auth/login/phone/verify ───────────────────────────────────────

  describe('phoneLoginVerify', () => {
    it('returns 200 with access token + sets refresh cookie on success', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'user-1',
        candidateId: 'profile-1',
      });
      prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser());
      tokenMock.issue.mockResolvedValue(TOKENS);
      const res = makeRes();

      const result = await controller.phoneLoginVerify(
        { phone: '+911234567890', otp: '123456' },
        mockReq,
        res,
      );

      expect(result.data.accessToken).toBe('acc-token');
      expect(result.data.user.role).toBe(UserRole.CANDIDATE);
      expect(res.cookie).toHaveBeenCalledWith(
        'sic_refresh',
        'ref-token',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('throws 401 when OtpService.verify fails (bad OTP)', async () => {
      otpMock.verify.mockRejectedValue(new UnauthorizedException({ code: 'INVALID_OTP' }));
      await expect(
        controller.phoneLoginVerify({ phone: '+911234567890', otp: '000000' }, mockReq, makeRes()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when no candidate profile is found for the phone after verify', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue(null);
      await expect(
        controller.phoneLoginVerify({ phone: '+911234567890', otp: '123456' }, mockReq, makeRes()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 403 ACCOUNT_SUSPENDED for a suspended candidate', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'user-1',
        candidateId: 'profile-1',
      });
      prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ status: UserStatus.SUSPENDED }));
      await expect(
        controller.phoneLoginVerify({ phone: '+911234567890', otp: '123456' }, mockReq, makeRes()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('issues tokens via TokenService with the same interface as email login', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'user-1',
        candidateId: 'profile-1',
      });
      prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      await controller.phoneLoginVerify(
        { phone: '+911234567890', otp: '123456' },
        mockReq,
        makeRes(),
      );

      expect(tokenMock.issue).toHaveBeenCalledWith(
        'user-1',
        UserRole.CANDIDATE,
        '1.2.3.4',
        undefined,
      );
    });

    it('OTP purpose isolation: cannot use a LOGIN code at /otp/verify (purpose mismatch)', async () => {
      // Simulate OtpService returning INVALID_OTP for a LOGIN code on PHONE_VERIFY path
      otpMock.verify.mockRejectedValue(new UnauthorizedException({ code: 'INVALID_OTP' }));
      const currentUser = {
        userId: 'user-1',
        role: UserRole.CANDIDATE,
        jti: 'jti-abc',
        exp: 9999999999,
      };

      await expect(
        controller.verifyOtp({ phone: '+911234567890', otp: '123456' }, currentUser),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

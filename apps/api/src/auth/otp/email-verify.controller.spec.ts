import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CandidateReadService } from '../../candidate/candidate-read.service';

/**
 * The email-verification half of the phone-signup flow.
 *
 * A candidate who signed up with a phone number has `email: null`. Onboarding
 * asks for an address and proves it with a code, and only then is the address
 * written. These tests pin the two properties that make that safe: an address
 * is never stored without proof, and one person can never take an address that
 * already belongs to somebody else.
 */

const ACTOR = {
  userId: 'user-1',
  role: UserRole.CANDIDATE,
  jti: 'jti-abc',
  exp: 9999999999,
};

const mockReq = { ip: '1.2.3.4', headers: {} } as unknown as import('express').Request;

describe('OtpController — email verification', () => {
  let controller: OtpController;
  let otpMock: jest.Mocked<Pick<OtpService, 'issueEmail' | 'verifyEmail'>>;
  let prismaMock: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    otpMock = {
      issueEmail: jest.fn().mockResolvedValue({ outcome: 'SENT' }),
      verifyEmail: jest.fn().mockResolvedValue({ challenge: {} }),
    } as unknown as jest.Mocked<Pick<OtpService, 'issueEmail' | 'verifyEmail'>>;

    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({
          email: 'new@example.com',
          emailVerifiedAt: new Date('2026-08-23T00:00:00.000Z'),
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: otpMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: TokenService, useValue: { issue: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'development' } },
        {
          provide: CandidateReadService,
          useValue: { findCandidateUserByVerifiedPhone: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(OtpController);
  });

  // ─── POST /auth/email/verify/start ───────────────────────────────────────

  describe('start', () => {
    it('sends a code to an address nobody holds', async () => {
      const result = await controller.emailVerifyStart(
        { email: 'new@example.com' },
        ACTOR,
        mockReq,
      );
      expect(result).toEqual({ data: { sent: true } });
      expect(otpMock.issueEmail).toHaveBeenCalledWith('new@example.com', '1.2.3.4');
    });

    /**
     * Rejected BEFORE a code is sent. Sending first would mail a code to an
     * address the caller can never attach, and would tell a stranger that the
     * address they typed has an account here.
     */
    it('refuses an address registered to somebody else, without sending', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'someone-else' });
      await expect(
        controller.emailVerifyStart({ email: 'taken@example.com' }, ACTOR, mockReq),
      ).rejects.toThrow(ConflictException);
      expect(otpMock.issueEmail).not.toHaveBeenCalled();
    });

    it('lets the caller re-verify the address already on their own account', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: ACTOR.userId });
      await expect(
        controller.emailVerifyStart({ email: 'mine@example.com' }, ACTOR, mockReq),
      ).resolves.toEqual({ data: { sent: true } });
    });

    /**
     * The send is inline (Decision 1), so a provider outage is visible on this
     * request. 503 tells the UI to offer a retry rather than leaving someone on
     * a code screen waiting for mail that never left.
     */
    it('surfaces a provider failure as 503 rather than claiming success', async () => {
      otpMock.issueEmail.mockResolvedValue({ outcome: 'SEND_FAILED' } as never);
      await expect(
        controller.emailVerifyStart({ email: 'new@example.com' }, ACTOR, mockReq),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ─── POST /auth/email/verify/confirm ─────────────────────────────────────

  describe('confirm', () => {
    it('writes the address and its proof together, in one update', async () => {
      const result = await controller.emailVerifyConfirm(
        { email: 'new@example.com', otp: '123456' },
        ACTOR,
      );

      expect(otpMock.verifyEmail).toHaveBeenCalledWith('new@example.com', '123456');
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);

      const [[call]] = prismaMock.user.update.mock.calls;
      expect(call.where).toEqual({ id: ACTOR.userId });
      expect(call.data.email).toBe('new@example.com');
      // Both fields in the same write — an address can never land unverified.
      expect(call.data.emailVerifiedAt).toBeInstanceOf(Date);

      expect(result.data.email).toBe('new@example.com');
    });

    it('does not write anything when the code is wrong', async () => {
      otpMock.verifyEmail.mockRejectedValue(new UnauthorizedException({ code: 'INVALID_OTP' }));
      await expect(
        controller.emailVerifyConfirm({ email: 'new@example.com', otp: '000000' }, ACTOR),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    /**
     * The race the second check exists for: two people start verification for
     * the same address, and the other one confirms during the five minutes this
     * caller's code is alive. Proving the code does not entitle you to an
     * address somebody else has since taken.
     */
    it('refuses an address claimed by somebody else while the code was valid', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'someone-else' });
      await expect(
        controller.emailVerifyConfirm({ email: 'new@example.com', otp: '123456' }, ACTOR),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });
});

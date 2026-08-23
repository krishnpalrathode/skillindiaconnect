import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserRole } from '@prisma/client';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CandidateReadService } from '../../candidate/candidate-read.service';

/**
 * Phone signup — creating an account whose credential is a phone number.
 *
 * The property worth protecting here is that the account is never half-built.
 * A user row without a verified phone on this path is an account nobody can
 * ever sign back in to: there is no email and no password yet, so the phone is
 * the only way in. That is why the profile is written in the same transaction.
 */

const PHONE = '+919876500123';
const TOKENS = { accessToken: 'acc-token', refreshToken: 'ref-token', refreshExp: 9999999999 };

const mockReq = { ip: '1.2.3.4', headers: {} } as unknown as import('express').Request;
const makeRes = () => ({ cookie: jest.fn() }) as unknown as import('express').Response;

describe('OtpController — phone signup', () => {
  let controller: OtpController;
  let otpMock: jest.Mocked<Pick<OtpService, 'issue' | 'verify'>>;
  let candidateReadMock: jest.Mocked<
    Pick<CandidateReadService, 'findCandidateUserByVerifiedPhone'>
  >;
  let txMock: {
    user: { create: jest.Mock };
    candidateProfile: { create: jest.Mock };
  };
  let prismaMock: { $transaction: jest.Mock };

  beforeEach(async () => {
    otpMock = {
      issue: jest.fn().mockResolvedValue({ outcome: 'SENT' }),
      verify: jest.fn().mockResolvedValue({ challenge: {} }),
    } as unknown as jest.Mocked<Pick<OtpService, 'issue' | 'verify'>>;

    candidateReadMock = { findCandidateUserByVerifiedPhone: jest.fn().mockResolvedValue(null) };

    txMock = {
      user: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'new-user', email: null, role: UserRole.CANDIDATE }),
      },
      candidateProfile: { create: jest.fn().mockResolvedValue({}) },
    };

    prismaMock = {
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: otpMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: TokenService, useValue: { issue: jest.fn().mockResolvedValue(TOKENS) } },
        { provide: ConfigService, useValue: { get: () => 'development' } },
        { provide: CandidateReadService, useValue: candidateReadMock },
      ],
    }).compile();

    controller = module.get(OtpController);
  });

  // ─── POST /auth/signup/phone/start ───────────────────────────────────────

  describe('start', () => {
    it('sends a PHONE_VERIFY code to an unregistered number', async () => {
      await expect(controller.phoneSignupStart({ phone: PHONE }, mockReq)).resolves.toEqual({
        data: { sent: true },
      });
      expect(otpMock.issue).toHaveBeenCalledWith(PHONE, OtpPurpose.PHONE_VERIFY, '1.2.3.4');
    });

    /**
     * Signup deliberately answers this, unlike login. Staying silent would
     * either create a second account on the number or leave someone tapping
     * "Get OTP" forever — and email signup already returns EMAIL_TAKEN, so the
     * oracle exists on this path either way.
     */
    it('tells the caller the number is already registered, without sending', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'existing',
      } as never);
      await expect(controller.phoneSignupStart({ phone: PHONE }, mockReq)).rejects.toThrow(
        ConflictException,
      );
      expect(otpMock.issue).not.toHaveBeenCalled();
    });

    it('surfaces an unreachable number so the UI can offer email instead', async () => {
      otpMock.issue.mockResolvedValue({ outcome: 'NOT_ON_WHATSAPP' } as never);
      await expect(controller.phoneSignupStart({ phone: PHONE }, mockReq)).rejects.toThrow(
        ConflictException,
      );
    });

    it('surfaces a provider failure as 503 rather than claiming success', async () => {
      otpMock.issue.mockResolvedValue({ outcome: 'SEND_FAILED' } as never);
      await expect(controller.phoneSignupStart({ phone: PHONE }, mockReq)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── POST /auth/signup/phone/verify ──────────────────────────────────────

  describe('verify', () => {
    const body = { phone: PHONE, otp: '123456', acceptedTerms: true as const };

    it('creates the account with no email and no password — the phone is the credential', async () => {
      const result = await controller.phoneSignupVerify(body, mockReq, makeRes());

      const [[userArgs]] = txMock.user.create.mock.calls;
      expect(userArgs.data.email).toBeNull();
      expect(userArgs.data.passwordHash).toBeNull();
      expect(userArgs.data.role).toBe(UserRole.CANDIDATE);
      // Terms are dated to account creation, as on the email signup path.
      expect(userArgs.data.termsAcceptedAt).toBeInstanceOf(Date);

      expect(result.data.user.email).toBeNull();
      expect(result.data.accessToken).toBe(TOKENS.accessToken);
    });

    /**
     * The core guarantee. Both writes go through the same transaction callback,
     * so there is no committed state in which the user exists without the
     * verified phone that is their only way back in.
     */
    it('writes the user and the verified-phone profile in ONE transaction', async () => {
      await controller.phoneSignupVerify(body, mockReq, makeRes());

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.user.create).toHaveBeenCalledTimes(1);
      expect(txMock.candidateProfile.create).toHaveBeenCalledTimes(1);

      const [[profileArgs]] = txMock.candidateProfile.create.mock.calls;
      expect(profileArgs.data.userId).toBe('new-user');
      expect(profileArgs.data.phone).toBe(PHONE);
      expect(profileArgs.data.phoneVerifiedAt).toBeInstanceOf(Date);
      // A code was just delivered over WhatsApp and answered.
      expect(profileArgs.data.whatsappCapable).toBe(true);
    });

    it('creates nothing when the code is wrong', async () => {
      otpMock.verify.mockRejectedValue(new UnauthorizedException({ code: 'INVALID_OTP' }));
      await expect(controller.phoneSignupVerify(body, mockReq, makeRes())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    /**
     * The race: somebody else finishes signup on this number during the five
     * minutes the code stays valid. Proving the code does not entitle you to a
     * number that has since been taken.
     */
    it('refuses a number claimed while the code was still valid', async () => {
      candidateReadMock.findCandidateUserByVerifiedPhone.mockResolvedValue({
        userId: 'existing',
      } as never);
      await expect(controller.phoneSignupVerify(body, mockReq, makeRes())).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('sets the refresh cookie, so signup signs them straight in', async () => {
      const res = makeRes();
      await controller.phoneSignupVerify(body, mockReq, res);
      expect(res.cookie).toHaveBeenCalled();
    });
  });
});

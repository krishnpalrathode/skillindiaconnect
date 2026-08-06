/**
 * CR-WA W1.5 — the OTP send tells the truth, WITHOUT becoming an oracle.
 *
 * THE BUG THIS CLOSES: `issue()` returned `{ sent: true }` for every outcome
 * except notOnWhatsapp — including outright send failures. The delivery row said
 * FAILED while the API said "sent", so during a provider outage a user was shown
 * "code sent", waited for a code that was never dispatched, and had no way
 * forward. On the login path that is a lockout, and it contradicted
 * worker-and-external-sends.md's "never silently claim a notification was
 * delivered". Binding the real Meta adapter is what turned it from theoretical
 * into reachable.
 *
 * THE CONSTRAINT THAT MAKES IT SUBTLE: the two OTP entry points differ.
 *
 *   otp/send          NO account lookup — always attempts a send. Its outcomes
 *                     describe WhatsApp and the provider, never registration,
 *                     so surfacing them leaks nothing.
 *   login/phone/start Looks the account up and only sends for a REGISTERED
 *                     number. ANY outcome-dependent response there — including
 *                     an honest failure — tells an attacker the number is
 *                     registered. It must answer identically, always.
 */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OtpPurpose } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TokenService } from '../token.service';
import { CandidateReadService } from '../../candidate/candidate-read.service';

const REQ = { ip: '1.2.3.4', headers: {} } as never;
const PHONE = '+911234567890';

describe('OTP send honesty + enumeration safety', () => {
  let controller: OtpController;
  const issue = jest.fn();
  const applyIpBudget = jest.fn();
  const findCandidateUserByVerifiedPhone = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: { issue, applyIpBudget, verify: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: TokenService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: CandidateReadService, useValue: { findCandidateUserByVerifiedPhone } },
      ],
    }).compile();
    controller = moduleRef.get(OtpController);
  });

  // ── otp/send: outcomes ARE surfaced (no account lookup here) ───────────────

  describe('otp/send — the user learns what actually happened', () => {
    it('SENT → 200 { sent: true }', async () => {
      issue.mockResolvedValue({ outcome: 'SENT' });
      await expect(controller.sendOtp({ phone: PHONE }, REQ)).resolves.toEqual({
        data: { sent: true },
      });
    });

    it('SEND_FAILED → 503, NOT a false "sent: true"', async () => {
      // The whole point: a failed send must never be reported as a success.
      issue.mockResolvedValue({ outcome: 'SEND_FAILED' });
      await expect(controller.sendOtp({ phone: PHONE }, REQ)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('SEND_FAILED carries a machine code AND tells the UI a fallback exists', async () => {
      issue.mockResolvedValue({ outcome: 'SEND_FAILED' });
      const err = await controller.sendOtp({ phone: PHONE }, REQ).catch((e: unknown) => e);
      const body = (err as ServiceUnavailableException).getResponse() as {
        code: string;
        meta: { fallbackAvailable: boolean };
      };
      // Without this the client can only show a generic error, which leaves the
      // user exactly as stuck as the old false success did.
      expect(body.code).toBe('OTP_SEND_FAILED');
      expect(body.meta.fallbackAvailable).toBe(true);
    });

    it('NOT_ON_WHATSAPP → 409, unchanged', async () => {
      issue.mockResolvedValue({ outcome: 'NOT_ON_WHATSAPP' });
      await expect(controller.sendOtp({ phone: PHONE }, REQ)).rejects.toThrow(ConflictException);
    });
  });

  // ── login/phone/start: the response must be a CONSTANT ────────────────────

  describe('login/phone/start — enumeration safety survives the change', () => {
    const IDENTICAL = { data: { message: 'If an account exists, an OTP has been sent.' } };

    it.each([['SENT'], ['SEND_FAILED'], ['NOT_ON_WHATSAPP']])(
      'a REGISTERED number whose send outcome is %s answers identically',
      async (outcome) => {
        findCandidateUserByVerifiedPhone.mockResolvedValue({ userId: 'u1', candidateId: 'c1' });
        issue.mockResolvedValue({ outcome });
        await expect(controller.phoneLoginStart({ phone: PHONE }, REQ)).resolves.toEqual(IDENTICAL);
      },
    );

    it('an UNREGISTERED number answers identically, and no send is attempted', async () => {
      findCandidateUserByVerifiedPhone.mockResolvedValue(null);
      await expect(controller.phoneLoginStart({ phone: PHONE }, REQ)).resolves.toEqual(IDENTICAL);
      expect(issue).not.toHaveBeenCalled();
      // The IP budget is still spent so the two branches cost the same.
      expect(applyIpBudget).toHaveBeenCalledWith('1.2.3.4');
    });

    it('THE ORACLE TEST: every branch produces one and the same body', async () => {
      // If this ever collects more than one distinct response, the endpoint has
      // become an account-existence oracle — a failure would imply registration.
      const bodies: string[] = [];

      findCandidateUserByVerifiedPhone.mockResolvedValue(null);
      bodies.push(JSON.stringify(await controller.phoneLoginStart({ phone: PHONE }, REQ)));

      for (const outcome of ['SENT', 'SEND_FAILED', 'NOT_ON_WHATSAPP']) {
        findCandidateUserByVerifiedPhone.mockResolvedValue({ userId: 'u1', candidateId: 'c1' });
        issue.mockResolvedValue({ outcome });
        bodies.push(JSON.stringify(await controller.phoneLoginStart({ phone: PHONE }, REQ)));
      }

      expect(new Set(bodies).size).toBe(1);
    });

    it('never THROWS on any outcome — a thrown error would be an oracle too', async () => {
      // A 503 here would be just as revealing as a different body.
      findCandidateUserByVerifiedPhone.mockResolvedValue({ userId: 'u1', candidateId: 'c1' });
      for (const outcome of ['SENT', 'SEND_FAILED', 'NOT_ON_WHATSAPP']) {
        issue.mockResolvedValue({ outcome });
        await expect(controller.phoneLoginStart({ phone: PHONE }, REQ)).resolves.toBeDefined();
      }
    });
  });

  it('the LOGIN purpose is what phone-login issues', async () => {
    findCandidateUserByVerifiedPhone.mockResolvedValue({ userId: 'u1', candidateId: 'c1' });
    issue.mockResolvedValue({ outcome: 'SENT' });
    await controller.phoneLoginStart({ phone: PHONE }, REQ);
    expect(issue).toHaveBeenCalledWith(PHONE, OtpPurpose.LOGIN, '1.2.3.4');
  });
});

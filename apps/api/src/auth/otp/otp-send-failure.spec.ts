/**
 * CR-WA W1 — THE DECISIVE TEST.
 *
 * OtpService.issue() runs on a SYNCHRONOUS auth request (the documented OTP
 * exception in worker-and-external-sends.md). If the WhatsApp adapter ever
 * throws instead of returning `ok:false`, that exception surfaces as a 500 on
 * login: the user asked for a code, got a server error, and has no fallback.
 * They are locked out with no recourse.
 *
 * That is the precise regression option C was chosen to PREVENT, so it is
 * asserted here against OtpService itself — not against the adapter. The
 * adapter's own spec proves it resolves; this proves the CALLER survives every
 * shape of failure, including one from a future adapter that regresses.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DeliveryStatus, OtpPurpose } from '@prisma/client';
import { OtpService } from './otp.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { WHATSAPP_CHANNEL } from '../../notifications/channels/whatsapp.channel';

const PHONE = '+911234567890';
const IP = '203.0.113.9';

describe('OtpService.issue — a send failure must never become a 500', () => {
  let service: OtpService;
  let prismaMock: {
    $transaction: jest.Mock;
    otpChallenge: Record<string, jest.Mock>;
    whatsappMessage: { create: jest.Mock };
  };
  const sendOtp = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const redisMock = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
    prismaMock = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          otpChallenge: { updateMany: jest.fn(), create: jest.fn() },
        }),
      ),
      otpChallenge: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      whatsappMessage: { create: jest.fn().mockResolvedValue({ id: 'wa-1' }) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: WHATSAPP_CHANNEL, useValue: { sendOtp } },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  it.each([
    ['a network failure', { ok: false, errorCode: 'ENETWORK' }],
    ['a timeout', { ok: false, errorCode: 'ETIMEDOUT' }],
    ['an auth failure (bad token)', { ok: false, errorCode: 'EAUTH' }],
    ['a provider 5xx', { ok: false, errorCode: 'PROVIDER_ERROR' }],
    ['a Meta-specific error code', { ok: false, errorCode: 'META_131047' }],
  ])('%s resolves normally — the caller gets an answer, not an exception', async (_label, result) => {
    sendOtp.mockResolvedValue(result);

    // RESOLVES. A rejection here is a 500 on the login screen.
    await expect(service.issue(PHONE, OtpPurpose.LOGIN, IP)).resolves.toBeDefined();
  });

  it('an unreachable number returns notOnWhatsapp so the UI can fall back', async () => {
    // This signal is the entire reason the OTP send stayed synchronous — it is
    // only knowable from Meta's response.
    sendOtp.mockResolvedValue({ ok: false, notOnWhatsapp: true, errorCode: 'NOT_ON_WHATSAPP' });

    await expect(service.issue(PHONE, OtpPurpose.LOGIN, IP)).resolves.toEqual({
      sent: false,
      notOnWhatsapp: true,
    });
  });

  describe('a THROWING adapter — the guarantee, not just the contract', () => {
    // The adapter contract says a send never throws, and meta-whatsapp.channel
    // proves it across every rejection path. But on the AUTH path that contract
    // is one class's discipline standing between a user and their account, so
    // OtpService catches too. A comment is a request; a try/catch is a guarantee.

    it.each([
      ['a plain Error', new Error('adapter regressed')],
      ['a TypeError from fetch', new TypeError('fetch failed')],
      ['a non-Error throw', 'something threw a string'],
    ])('%s does NOT become a 500 — it resolves', async (_label, thrown) => {
      sendOtp.mockRejectedValue(thrown);
      await expect(service.issue(PHONE, OtpPurpose.LOGIN, IP)).resolves.toBeDefined();
    });

    it('is handled IDENTICALLY to ok:false', async () => {
      sendOtp.mockRejectedValue(new Error('boom'));
      const thrownResult = await service.issue(PHONE, OtpPurpose.LOGIN, IP);

      sendOtp.mockResolvedValue({ ok: false, errorCode: 'ENETWORK' });
      const okFalseResult = await service.issue(PHONE, OtpPurpose.LOGIN, IP);

      expect(thrownResult).toEqual(okFalseResult);
    });

    it('still records the delivery row as FAILED — the ledger stays honest', async () => {
      sendOtp.mockRejectedValue(new Error('boom'));
      await service.issue(PHONE, OtpPurpose.LOGIN, IP);

      const row = (prismaMock.whatsappMessage.create as jest.Mock).mock.calls[0]?.[0]?.data;
      expect(row.status).toBe(DeliveryStatus.FAILED);
      expect(row.waMessageId).toBeNull();
    });

    it('logs the contract violation WITHOUT the phone or the code', async () => {
      const lines: string[] = [];
      jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((m: unknown) => void lines.push(String(m)));

      sendOtp.mockRejectedValue(new Error('boom'));
      await service.issue(PHONE, OtpPurpose.LOGIN, IP);

      const all = lines.join(' ');
      expect(all).toMatch(/no-throw contract/i);
      expect(all).not.toContain(PHONE);
      expect(all).not.toContain('1234567890');
    });
  });

  it('a successful send reports sent:true', async () => {
    sendOtp.mockResolvedValue({ ok: true, providerMessageId: 'wamid.X' });
    await expect(service.issue(PHONE, OtpPurpose.LOGIN, IP)).resolves.toEqual({ sent: true });
  });
});

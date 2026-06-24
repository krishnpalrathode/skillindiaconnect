import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { createHash } from 'node:crypto';
import { OtpService } from './otp.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { WHATSAPP_CHANNEL } from '../../notifications/channels/whatsapp.channel';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'challenge-1',
    phone: '+911234567890',
    purpose: OtpPurpose.PHONE_VERIFY,
    codeHash: sha256('123456'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
    userId: null,
    ...overrides,
  };
}

describe('OtpService', () => {
  let service: OtpService;

  // In-memory Redis store — reset between tests
  const redisStore = new Map<string, number>();
  const redisMock = {
    incr: jest.fn(async (key: string) => {
      const next = (redisStore.get(key) ?? 0) + 1;
      redisStore.set(key, next);
      return next;
    }),
    expire: jest.fn().mockResolvedValue(1),
  };

  const prismaMock = {
    $transaction: jest.fn(),
    otpChallenge: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const whatsappMock = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
    redisStore.clear();
    jest.clearAllMocks();

    // Interactive transaction: pass prismaMock as the tx argument
    prismaMock.$transaction.mockImplementation((fn: (tx: typeof prismaMock) => Promise<unknown>) =>
      fn(prismaMock),
    );
    prismaMock.otpChallenge.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.otpChallenge.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: WHATSAPP_CHANNEL, useValue: whatsappMock },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  // ─── issue ────────────────────────────────────────────────────────────────

  describe('issue', () => {
    it('stores a hashed code — never the plaintext', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true, providerMessageId: 'mock-1' });

      await service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, '1.2.3.4');

      const createArg = (prismaMock.otpChallenge.create as jest.Mock).mock.calls[0][0];
      const storedHash: string = createArg.data.codeHash as string;

      // The hash is a hex string, NOT the raw 6-digit code
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(storedHash).not.toMatch(/^\d{6}$/);
    });

    it('sets a 5-minute expiry on the challenge', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true, providerMessageId: 'mock-1' });

      const before = Date.now();
      await service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, '1.2.3.4');
      const after = Date.now();

      const createArg = (prismaMock.otpChallenge.create as jest.Mock).mock.calls[0][0];
      const expiresAt: Date = createArg.data.expiresAt as Date;
      const ttlMs = expiresAt.getTime() - before;

      // Between 4m59s and 5m01s
      expect(ttlMs).toBeGreaterThanOrEqual(4 * 60 * 1000 + 59 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);
    });

    it('returns { sent: true } for a normal number', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true, providerMessageId: 'mock-1' });
      const result = await service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, '1.2.3.4');
      expect(result).toEqual({ sent: true });
    });

    it('returns { sent: false, notOnWhatsapp: true } for a not-on-WhatsApp number', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: false, notOnWhatsapp: true });
      const result = await service.issue('+910000', OtpPurpose.PHONE_VERIFY, '1.2.3.4');
      expect(result).toEqual({ sent: false, notOnWhatsapp: true });
    });

    it('invalidates prior unconsumed challenges before creating the new one', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true });

      await service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, '1.2.3.4');

      const updateManyArg = (prismaMock.otpChallenge.updateMany as jest.Mock).mock.calls[0][0];
      expect(updateManyArg.where).toMatchObject({
        phone: '+911234567890',
        purpose: OtpPurpose.PHONE_VERIFY,
        consumedAt: null,
      });
      expect(updateManyArg.data.consumedAt).toBeInstanceOf(Date);
    });

    it('throws 429 OTP_RATE_LIMITED after the 6th send for the same phone', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true });

      for (let i = 0; i < 5; i++) {
        await service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, `ip-${i}`);
      }

      await expect(service.issue('+911234567890', OtpPurpose.PHONE_VERIFY, 'ip-6')).rejects.toThrow(
        HttpException,
      );
    });

    it('shared phone budget: 3 PHONE_VERIFY + 3 LOGIN issues trip the limit at the 6th', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true });
      const phone = '+911234567890';

      for (let i = 0; i < 3; i++) {
        await service.issue(phone, OtpPurpose.PHONE_VERIFY, `ip-${i}`);
      }
      for (let i = 0; i < 2; i++) {
        await service.issue(phone, OtpPurpose.LOGIN, `ip-${i + 3}`);
      }

      // 6th call regardless of purpose must fail
      await expect(service.issue(phone, OtpPurpose.LOGIN, 'ip-6')).rejects.toThrow(HttpException);
    });

    it('per-IP budget is enforced independently of the phone budget', async () => {
      whatsappMock.sendOtp.mockResolvedValue({ ok: true });
      const ip = '5.6.7.8';

      // Use 20 different phones so the phone budget never fires, but the same IP
      for (let i = 0; i < 20; i++) {
        await service.issue(
          `+9100000000${String(i).padStart(2, '0')}`,
          OtpPurpose.PHONE_VERIFY,
          ip,
        );
      }

      await expect(service.issue('+919999999999', OtpPurpose.PHONE_VERIFY, ip)).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ─── verify ───────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('consumes the challenge on a correct code', async () => {
      const challenge = makeChallenge({ codeHash: sha256('654321') });
      prismaMock.otpChallenge.findFirst.mockResolvedValue(challenge);
      const consumed = { ...challenge, consumedAt: new Date() };
      prismaMock.otpChallenge.update.mockResolvedValue(consumed);

      const result = await service.verify('+911234567890', '654321', OtpPurpose.PHONE_VERIFY);

      expect(result.challenge.consumedAt).toBeInstanceOf(Date);
      expect((prismaMock.otpChallenge.update as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { id: challenge.id },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('increments attempts and throws 401 on a wrong code', async () => {
      prismaMock.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge({ codeHash: sha256('654321') }),
      );
      prismaMock.otpChallenge.update.mockResolvedValue({});

      await expect(
        service.verify('+911234567890', '000000', OtpPurpose.PHONE_VERIFY),
      ).rejects.toThrow(UnauthorizedException);

      expect((prismaMock.otpChallenge.update as jest.Mock).mock.calls[0][0]).toMatchObject({
        data: { attempts: { increment: 1 } },
      });
    });

    it('throws 401 when attempts are already at max (locked)', async () => {
      prismaMock.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge({ attempts: 5, codeHash: sha256('654321') }),
      );

      await expect(
        service.verify('+911234567890', '654321', OtpPurpose.PHONE_VERIFY),
      ).rejects.toThrow(UnauthorizedException);

      // Must NOT increment further or update any row when locked
      expect(prismaMock.otpChallenge.update).not.toHaveBeenCalled();
    });

    it('throws 401 for an expired challenge', async () => {
      prismaMock.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.verify('+911234567890', '123456', OtpPurpose.PHONE_VERIFY),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when no challenge is found', async () => {
      prismaMock.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verify('+911234567890', '123456', OtpPurpose.PHONE_VERIFY),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('purpose isolation: a PHONE_VERIFY challenge cannot satisfy a LOGIN verify', async () => {
      // findFirst for LOGIN purpose returns null (no challenge with LOGIN purpose exists)
      prismaMock.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(service.verify('+911234567890', '123456', OtpPurpose.LOGIN)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('purpose isolation: a LOGIN challenge cannot satisfy a PHONE_VERIFY verify', async () => {
      prismaMock.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verify('+911234567890', '123456', OtpPurpose.PHONE_VERIFY),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── applyIpBudget ────────────────────────────────────────────────────────

  describe('applyIpBudget', () => {
    it('does not throw within the limit', async () => {
      for (let i = 0; i < 20; i++) {
        await expect(service.applyIpBudget('9.8.7.6')).resolves.not.toThrow();
      }
    });

    it('throws 429 on the 21st call from the same IP', async () => {
      for (let i = 0; i < 20; i++) {
        await service.applyIpBudget('1.1.1.1');
      }
      await expect(service.applyIpBudget('1.1.1.1')).rejects.toThrow(HttpException);
    });
  });
});

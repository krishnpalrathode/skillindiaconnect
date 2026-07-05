/**
 * Unit tests for NotificationProcessor (correctness-critical paths).
 *
 * All DB and channel interactions are mocked — no Docker required.
 *
 * Tests:
 * - whatsappCapable:false → DOWNGRADE to email, no WhatsApp send.
 * - WhatsApp send failure on last retry → FAILED row + email FALLBACK, never DELIVERED.
 * - Successful WhatsApp send → QUEUED→SENT row + providerMessageId + audit.
 * - Successful email send → QUEUED→SENT row.
 * - Mock bounce address → BOUNCED email_messages row.
 * - Email opt-out → no email sent.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryStatus, NotificationType, WaMessageKind } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { WHATSAPP_CHANNEL, WhatsappSendResult } from './channels/whatsapp.channel';
import { EMAIL_CHANNEL, EmailSendResult } from './channels/email.channel';
import { MOCK_BOUNCE_EMAIL } from './channels/email.mock';
import { NotificationProcessor } from './notification.processor';
import { NotificationJobData } from './notification.types';

// ── Shared test fixtures ─────────────────────────────────────────────────────

const USER_ID = 'user-abc';
const PHONE = '+919876543210';
const EMAIL = 'user@example.com';

const BASE_JOB_DATA: Omit<NotificationJobData, 'channel'> = {
  userId: USER_ID,
  type: NotificationType.APPLICATION_SELECTED,
  payload: { title: 'You were selected', body: 'Congrats' },
};

function makeJob(
  channel: 'whatsapp' | 'email',
  overrides: Partial<Pick<Job, 'attemptsMade' | 'opts'>> = {},
): Job<NotificationJobData> {
  return {
    data: { ...BASE_JOB_DATA, channel },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.opts?.attempts ?? 3, ...(overrides.opts ?? {}) },
  } as unknown as Job<NotificationJobData>;
}

// ── Prisma mock helpers ──────────────────────────────────────────────────────

function makePrismaMock(overrides: {
  whatsappCapable?: boolean;
  phone?: string | null;
  waNotifications?: boolean;
  emailNotifs?: boolean;
  email?: string;
} = {}) {
  const whatsappCapable = overrides.whatsappCapable ?? true;
  // Use !== undefined so that an explicit null is preserved (not replaced by default)
  const phone = overrides.phone !== undefined ? overrides.phone : PHONE;
  const email = overrides.email !== undefined ? overrides.email : EMAIL;
  const waNotifications = overrides.waNotifications ?? true;
  const emailNotifs = overrides.emailNotifs ?? true;

  // Mutable WA message row (simulates DB state)
  let waMsgRow: Record<string, unknown> | null = null;
  let emailMsgRow: Record<string, unknown> | null = null;

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ email }),
    },
    candidateProfile: {
      findFirst: jest.fn().mockResolvedValue({
        phone,
        whatsappCapable,
        waNotifications,
        emailNotifs,
      }),
    },
    whatsappMessage: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        waMsgRow = { id: 'wa-msg-id', ...data };
        return waMsgRow;
      }),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (waMsgRow) Object.assign(waMsgRow, data);
        return waMsgRow;
      }),
    },
    emailMessage: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        emailMsgRow = { id: 'email-msg-id', ...data };
        return emailMsgRow;
      }),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (emailMsgRow) Object.assign(emailMsgRow, data);
        return emailMsgRow;
      }),
    },
    getWaMsgRow: () => waMsgRow,
    getEmailMsgRow: () => emailMsgRow,
  };

  return prisma;
}

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let waSendSpy: jest.Mock;
  let emailSendSpy: jest.Mock;
  let auditLogSpy: jest.Mock;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  async function buildProcessor(prismaOverrides: Parameters<typeof makePrismaMock>[0] = {}) {
    prismaMock = makePrismaMock(prismaOverrides);
    waSendSpy = jest.fn();
    emailSendSpy = jest.fn();
    auditLogSpy = jest.fn().mockResolvedValue(undefined);

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: WHATSAPP_CHANNEL,
          useValue: { sendOtp: jest.fn(), sendTemplate: waSendSpy },
        },
        {
          provide: EMAIL_CHANNEL,
          useValue: { send: emailSendSpy },
        },
        {
          provide: AuditService,
          useValue: { log: auditLogSpy, logInTransaction: jest.fn() },
        },
      ],
    })
      .overrideProvider(QUEUE_NAMES.NOTIFICATION as never)
      .useValue({})
      .compile();

    processor = app.get(NotificationProcessor);
  }

  // ── WhatsApp downgrade path ─────────────────────────────────────────────────

  describe('WhatsApp — downgrade (whatsappCapable:false)', () => {
    beforeEach(() =>
      buildProcessor({ whatsappCapable: false, phone: PHONE }),
    );

    it('does NOT call sendTemplate', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' } satisfies EmailSendResult);
      await processor.process(makeJob('whatsapp'));
      expect(waSendSpy).not.toHaveBeenCalled();
    });

    it('creates a whatsapp_messages row with FAILED + NOT_WHATSAPP_CAPABLE', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      const created = prismaMock.whatsappMessage.create.mock.calls[0]?.[0]?.data;
      expect(created?.status).toBe(DeliveryStatus.FAILED);
      expect(created?.errorCode).toBe('NOT_WHATSAPP_CAPABLE');
    });

    it('falls back to email (sends via emailChannel)', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      expect(emailSendSpy).toHaveBeenCalledTimes(1);
    });

    it('email fallback creates an email_messages row', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      expect(prismaMock.emailMessage.create).toHaveBeenCalledTimes(1);
    });

    it('audits the downgrade', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ reason: 'whatsapp_downgrade' }) }),
      );
    });
  });

  // ── WhatsApp downgrade — no phone (employer) ─────────────────────────────────

  describe('WhatsApp — downgrade (no phone / employer user)', () => {
    beforeEach(() =>
      buildProcessor({ whatsappCapable: false, phone: null }),
    );

    it('skips whatsapp_messages row creation when no phone', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      expect(prismaMock.whatsappMessage.create).not.toHaveBeenCalled();
    });

    it('still falls back to email', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });
      await processor.process(makeJob('whatsapp'));
      expect(emailSendSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── WhatsApp failure-fallback (retry exhausted) ─────────────────────────────

  describe('WhatsApp — failure-fallback (retry exhausted)', () => {
    beforeEach(() => buildProcessor({ whatsappCapable: true, phone: PHONE }));

    it('marks whatsapp_messages FAILED — does NOT silently claim DELIVERED', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-fallback' });

      // Simulate last attempt: attemptsMade === attempts
      const job = makeJob('whatsapp', { attemptsMade: 3, opts: { attempts: 3 } });

      await expect(processor.process(job)).rejects.toThrow('Meta API error');

      const updated = prismaMock.whatsappMessage.update.mock.calls.at(-1)?.[0]?.data;
      expect(updated?.status).toBe(DeliveryStatus.FAILED);
    });

    it('does NOT mark whatsapp_messages SENT when it fails', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true });

      const job = makeJob('whatsapp', { attemptsMade: 3, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      const updateCalls = prismaMock.whatsappMessage.update.mock.calls;
      const statuses = updateCalls.map((c: [{ data: { status: DeliveryStatus } }]) => c[0].data.status);
      expect(statuses.every((s: DeliveryStatus) => s !== DeliveryStatus.SENT)).toBe(true);
    });

    it('sends email fallback after final retry failure', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'fallback-email' });

      const job = makeJob('whatsapp', { attemptsMade: 3, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      expect(emailSendSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT send email fallback on a non-final retry (retry still in progress)', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));

      // First attempt (1 of 3 — not the last)
      const job = makeJob('whatsapp', { attemptsMade: 1, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      expect(emailSendSpy).not.toHaveBeenCalled();
    });

    it('audits NOTIFICATION_FAILED on retry exhaustion', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true });

      const job = makeJob('whatsapp', { attemptsMade: 3, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ reason: 'retry_exhausted' }),
        }),
      );
    });
  });

  // ── WhatsApp successful send ─────────────────────────────────────────────────

  describe('WhatsApp — successful send', () => {
    const PROVIDER_ID = 'wa-provider-abc123';

    beforeEach(() => buildProcessor({ whatsappCapable: true, phone: PHONE }));

    it('calls sendTemplate with the right template key', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: PROVIDER_ID } satisfies WhatsappSendResult);

      await processor.process(makeJob('whatsapp'));

      expect(waSendSpy).toHaveBeenCalledWith(PHONE, 'wa.selected', {});
    });

    it('creates a QUEUED whatsapp_messages row then updates to SENT', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: PROVIDER_ID });

      await processor.process(makeJob('whatsapp'));

      const created = prismaMock.whatsappMessage.create.mock.calls[0]?.[0]?.data;
      expect(created?.status).toBe(DeliveryStatus.QUEUED);
      expect(created?.kind).toBe(WaMessageKind.STATUS_UPDATE);

      const updated = prismaMock.whatsappMessage.update.mock.calls[0]?.[0]?.data;
      expect(updated?.status).toBe(DeliveryStatus.SENT);
      expect(updated?.waMessageId).toBe(PROVIDER_ID);
    });

    it('audits NOTIFICATION_DELIVERED — phone NOT in meta', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: PROVIDER_ID });

      await processor.process(makeJob('whatsapp'));

      const auditCall = auditLogSpy.mock.calls[0]?.[0];
      expect(auditCall).toBeTruthy();
      const metaStr = JSON.stringify(auditCall?.meta ?? {});
      expect(metaStr).not.toContain(PHONE);
      expect(metaStr).not.toContain(EMAIL);
    });
  });

  // ── Email successful send ───────────────────────────────────────────────────

  describe('Email — successful send', () => {
    const PROVIDER_EMAIL_ID = 'ses-msg-xyz';

    beforeEach(() => buildProcessor());

    it('creates a QUEUED email_messages row then updates to SENT', async () => {
      emailSendSpy.mockResolvedValue({
        ok: true,
        providerMessageId: PROVIDER_EMAIL_ID,
      } satisfies EmailSendResult);

      await processor.process(makeJob('email'));

      const created = prismaMock.emailMessage.create.mock.calls[0]?.[0]?.data;
      expect(created?.status).toBe(DeliveryStatus.QUEUED);
      expect(created?.type).toBe(NotificationType.APPLICATION_SELECTED);

      const updated = prismaMock.emailMessage.update.mock.calls[0]?.[0]?.data;
      expect(updated?.status).toBe(DeliveryStatus.SENT);
      expect(updated?.sesMessageId).toBe(PROVIDER_EMAIL_ID);
    });

    it('audits NOTIFICATION_DELIVERED — toEmail NOT in meta', async () => {
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: PROVIDER_EMAIL_ID });

      await processor.process(makeJob('email'));

      const auditCall = auditLogSpy.mock.calls[0]?.[0];
      const metaStr = JSON.stringify(auditCall?.meta ?? {});
      expect(metaStr).not.toContain(EMAIL);
    });
  });

  // ── Email bounce ─────────────────────────────────────────────────────────────

  describe('Email — bounce', () => {
    beforeEach(() =>
      buildProcessor({ email: MOCK_BOUNCE_EMAIL }),
    );

    it('records email_messages status as BOUNCED', async () => {
      emailSendSpy.mockResolvedValue({ ok: false, bounced: true } satisfies EmailSendResult);

      await processor.process(makeJob('email'));

      const updated = prismaMock.emailMessage.update.mock.calls[0]?.[0]?.data;
      expect(updated?.status).toBe(DeliveryStatus.BOUNCED);
      expect(updated?.bounceType).toBe('hard');
    });

    it('does NOT throw on bounce (bounce is not a retryable error)', async () => {
      emailSendSpy.mockResolvedValue({ ok: false, bounced: true });
      await expect(processor.process(makeJob('email'))).resolves.toBeUndefined();
    });
  });

  // ── Email opt-out ────────────────────────────────────────────────────────────

  describe('Email — candidate opt-out', () => {
    beforeEach(() =>
      buildProcessor({ emailNotifs: false }),
    );

    it('skips send when emailNotifs = false', async () => {
      await processor.process(makeJob('email'));
      expect(emailSendSpy).not.toHaveBeenCalled();
      expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    });
  });
});

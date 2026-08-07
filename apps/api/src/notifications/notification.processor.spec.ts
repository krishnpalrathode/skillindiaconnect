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
import { MetricsService } from '../core/observability/metrics.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../core/storage/storage.service';
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

/** Params the raising module supplies for job_selected (CR-WA W0). */
const SELECTED_VARS = ['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC'];

const BASE_JOB_DATA: Omit<NotificationJobData, 'channel'> = {
  userId: USER_ID,
  type: NotificationType.APPLICATION_SELECTED,
  // A REALISTIC job carries its template parameters — APPLICATION_SELECTED is a
  // whatsapp:true type, so a payload without them is the failure case, not the
  // norm. Tests that want that case override `payload` explicitly.
  payload: { title: 'You were selected', body: 'Congrats', data: { templateVars: SELECTED_VARS } },
};

/** A payload with NO template parameters — the unresolvable-data case. */
const PAYLOAD_WITHOUT_VARS = { title: 'You were selected', body: 'Congrats' };

function makeJob(
  channel: 'whatsapp' | 'email',
  overrides: Partial<Pick<Job, 'attemptsMade' | 'opts'>> & {
    data?: Partial<NotificationJobData>;
  } = {},
): Job<NotificationJobData> {
  return {
    data: { ...BASE_JOB_DATA, channel, ...(overrides.data ?? {}) },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.opts?.attempts ?? 3, ...(overrides.opts ?? {}) },
    // Real BullMQ persists this to Redis; the processor pins the delivery-row
    // id here so retries reuse the row.
    updateData: jest.fn().mockResolvedValue(undefined),
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
      findUnique: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { id: string } }) =>
          waMsgRow && (waMsgRow as { id?: string })['id'] === where.id ? waMsgRow : null,
        ),
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
  let storageGetSpy: jest.Mock;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  async function buildProcessor(prismaOverrides: Parameters<typeof makePrismaMock>[0] = {}) {
    prismaMock = makePrismaMock(prismaOverrides);
    waSendSpy = jest.fn();
    storageGetSpy = jest.fn();
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
        {
          // CR-WA W0: resolves a document-template's R2 key to bytes at send
          // time. Returns a real Buffer so the document path is exercised.
          provide: StorageService,
          useValue: {
            getObjectBuffer: (storageGetSpy = jest.fn().mockResolvedValue({
              body: Buffer.from('%PDF-1.4 fake'),
              contentType: 'application/pdf',
            })),
          },
        },
        // The REAL MetricsService — it has no dependencies, and using the real
        // one means these specs exercise the counters the alerts fire on rather
        // than a stub that would hide a broken call site.
        MetricsService,
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

      // CHAOS-004: BullMQ increments attemptsMade when an attempt FAILS, so
      // while the FINAL attempt of a 3-attempt job is executing the counter
      // reads 2, not 3. These tests previously used 3 — a value the runtime
      // never produces inside the processor — which is why they passed while
      // the fallback was dead in production.
      const job = makeJob('whatsapp', { attemptsMade: 2, opts: { attempts: 3 } });

      await expect(processor.process(job)).rejects.toThrow('Meta API error');

      const updated = prismaMock.whatsappMessage.update.mock.calls.at(-1)?.[0]?.data;
      expect(updated?.status).toBe(DeliveryStatus.FAILED);
    });

    it('does NOT mark whatsapp_messages SENT when it fails', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true });

      const job = makeJob('whatsapp', { attemptsMade: 2, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      const updateCalls = prismaMock.whatsappMessage.update.mock.calls;
      const statuses = updateCalls.map((c: [{ data: { status: DeliveryStatus } }]) => c[0].data.status);
      expect(statuses.every((s: DeliveryStatus) => s !== DeliveryStatus.SENT)).toBe(true);
    });

    it('sends email fallback after final retry failure', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'fallback-email' });

      const job = makeJob('whatsapp', { attemptsMade: 2, opts: { attempts: 3 } });
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

    /**
     * CHAOS-004 regression. The bug was an off-by-one that made the fallback
     * unreachable for EVERY attempt count, so this walks the boundary across
     * several configurations rather than trusting one hand-picked pair.
     *
     * BullMQ's contract: inside the processor, `attemptsMade` is the number of
     * attempts that have already FAILED, so the attempt currently running is
     * `attemptsMade + 1`. The fallback must fire on exactly the last one.
     */
    it.each([
      { attempts: 1, attemptsMade: 0, isLast: true },
      { attempts: 2, attemptsMade: 0, isLast: false },
      { attempts: 2, attemptsMade: 1, isLast: true },
      { attempts: 3, attemptsMade: 0, isLast: false },
      { attempts: 3, attemptsMade: 1, isLast: false },
      { attempts: 3, attemptsMade: 2, isLast: true },
    ])(
      'email fallback fires only on the FINAL attempt (attempts=$attempts, attemptsMade=$attemptsMade → last=$isLast)',
      async ({ attempts, attemptsMade, isLast }) => {
        waSendSpy.mockRejectedValue(new Error('Meta API error'));
        emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'fallback' });

        const job = makeJob('whatsapp', { attemptsMade, opts: { attempts } });
        await expect(processor.process(job)).rejects.toThrow();

        expect({ attempts, attemptsMade, fellBack: emailSendSpy.mock.calls.length > 0 }).toEqual({
          attempts,
          attemptsMade,
          fellBack: isLast,
        });
      },
    );

    it('audits NOTIFICATION_FAILED on retry exhaustion', async () => {
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true });

      const job = makeJob('whatsapp', { attemptsMade: 2, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ reason: 'retry_exhausted' }),
        }),
      );
    });
  });

  // ── WhatsApp delivery-row lifecycle (one row per logical send) ───────────────

  describe('WhatsApp — delivery-row reuse across retries', () => {
    beforeEach(() => buildProcessor({ whatsappCapable: true, phone: PHONE }));

    it('first attempt creates the row and pins its id on the job (updateData)', async () => {
      waSendSpy.mockResolvedValue({ ok: false, errorCode: 'PROVIDER_DOWN' });

      const job = makeJob('whatsapp', { attemptsMade: 1, opts: { attempts: 3 } });
      await expect(processor.process(job)).rejects.toThrow();

      expect(prismaMock.whatsappMessage.create).toHaveBeenCalledTimes(1);
      expect(job.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ waMessageRowId: 'wa-msg-id' }),
      );
    });

    it('a retry reuses the pinned row — NO second create', async () => {
      waSendSpy.mockResolvedValue({ ok: false, errorCode: 'PROVIDER_DOWN' });

      // First attempt creates + pins the row.
      const first = makeJob('whatsapp', { attemptsMade: 1, opts: { attempts: 3 } });
      await expect(processor.process(first)).rejects.toThrow();
      const pinned = (first.updateData as jest.Mock).mock.calls[0]![0] as NotificationJobData;

      // Retry carries the pinned id (BullMQ persists updateData to Redis).
      const retry = makeJob('whatsapp', {
        attemptsMade: 2,
        opts: { attempts: 3 },
        data: { waMessageRowId: pinned.waMessageRowId },
      });
      await expect(processor.process(retry)).rejects.toThrow();

      // One logical send → one row: create ran ONCE across both attempts.
      expect(prismaMock.whatsappMessage.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.whatsappMessage.findUnique).toHaveBeenCalledWith({
        where: { id: 'wa-msg-id' },
      });
    });

    it('threads payload.data.applicationId onto the delivery row', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'wamid-1' });

      const job = makeJob('whatsapp', {
        data: {
          payload: {
            ...BASE_JOB_DATA.payload,
            // templateVars kept: a real APPLICATION_SELECTED payload carries
            // both, and dropping them here would test the failure path instead.
            data: { applicationId: 'app-123', templateVars: SELECTED_VARS },
          },
        },
      });
      await processor.process(job);

      const created = prismaMock.whatsappMessage.create.mock.calls[0]?.[0]?.data;
      expect(created?.applicationId).toBe('app-123');
    });
  });

  // ── WhatsApp successful send ─────────────────────────────────────────────────

  describe('WhatsApp — successful send', () => {
    const PROVIDER_ID = 'wa-provider-abc123';

    beforeEach(() => buildProcessor({ whatsappCapable: true, phone: PHONE }));

    it('calls sendTemplate with the right template key', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: PROVIDER_ID } satisfies WhatsappSendResult);

      await processor.process(makeJob('whatsapp'));

      // CR-WA W0: the third argument is now the template send, not `{}`.
      expect(waSendSpy).toHaveBeenCalledWith(PHONE, 'wa.selected', {
        bodyParams: SELECTED_VARS,
      });
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

  // ── CR-WA W0: the template-variable seam ─────────────────────────────────────

  describe('WhatsApp — template parameters', () => {
    beforeEach(() => buildProcessor({ whatsappCapable: true, phone: PHONE }));

    it('passes the ORDERED params from the payload straight through', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'wa-1' } satisfies WhatsappSendResult);
      const vars = ['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC'];

      await processor.process(
        makeJob('whatsapp', { data: { payload: { ...BASE_JOB_DATA.payload, data: { templateVars: vars } } } }),
      );

      // Third argument, positionally intact — the send is the last place the
      // order could be corrupted before it reaches Meta.
      expect(waSendSpy).toHaveBeenCalledWith(PHONE, expect.any(String), {
        bodyParams: vars,
      });
    });

    it('FAILS the send when params are missing — never placeholders', async () => {
      // The old behaviour passed {} here and the mock ignored it. Against the
      // real API that is error 132000; against a candidate it would be
      // "You have been selected for  at ".
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });

      await expect(
        processor.process(
          makeJob('whatsapp', {
            attemptsMade: 0,
            opts: { attempts: 3 },
            data: { payload: PAYLOAD_WITHOUT_VARS },
          }),
        ),
      ).rejects.toThrow(/template variables/i);

      expect(waSendSpy).not.toHaveBeenCalled();
      expect(prismaMock.getWaMsgRow()?.['errorCode']).toBe('TEMPLATE_VARS_MISSING');
      // NO ROW MAY REPORT SENT. The row is the delivery ledger; claiming SENT
      // for a message that was never handed to a provider is the exact
      // dishonesty worker-and-external-sends.md forbids.
      expect(prismaMock.getWaMsgRow()?.['status']).not.toBe(DeliveryStatus.SENT);
    });

    it('missing params on the LAST attempt still fall back to email', async () => {
      // The candidate must still hear about it — just by email.
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });

      await expect(
        processor.process(
          makeJob('whatsapp', {
            attemptsMade: 2,
            opts: { attempts: 3 },
            data: { payload: PAYLOAD_WITHOUT_VARS },
          }),
        ),
      ).rejects.toThrow();

      expect(emailSendSpy).toHaveBeenCalledTimes(1);
      expect(prismaMock.getWaMsgRow()?.['status']).toBe(DeliveryStatus.FAILED);
    });

    it('attaches the document bytes when the payload carries an R2 key', async () => {
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'wa-2' });

      await processor.process(
        makeJob('whatsapp', {
          data: {
            payload: {
              ...BASE_JOB_DATA.payload,
              data: {
                templateVars: ['Suresh Kumar'],
                documentKey: 'resumes/c1/r.pdf',
                documentFilename: 'Suresh-Kumar-Resume.pdf',
              },
            },
          },
        }),
      );

      expect(storageGetSpy).toHaveBeenCalledWith('resumes/c1/r.pdf');
      const send = waSendSpy.mock.calls[0]?.[2];
      expect(send.document.bytes.length).toBeGreaterThan(0);
      // Human filename — this is what the candidate sees in WhatsApp.
      expect(send.document.filename).toBe('Suresh-Kumar-Resume.pdf');
    });

    it('takes the filename from the PAYLOAD, never from bodyParams[0]', async () => {
      // Guards the decoupling: the filename must not depend on a template's
      // parameter ORDER. Here param 0 is deliberately NOT the filename source.
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'wa-3' });

      await processor.process(
        makeJob('whatsapp', {
          data: {
            payload: {
              ...BASE_JOB_DATA.payload,
              data: {
                templateVars: ['Not The Filename'],
                documentKey: 'resumes/c1/r.pdf',
                documentFilename: 'Chosen-By-Producer.pdf',
              },
            },
          },
        }),
      );

      expect(waSendSpy.mock.calls[0]?.[2].document.filename).toBe('Chosen-By-Producer.pdf');
    });

    it('falls back to a NEUTRAL filename when the producer supplies none', async () => {
      // Deliberately generic: the notification module cannot know what the
      // document is, so guessing "Resume.pdf" would be worse than being plain.
      waSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'wa-4' });

      await processor.process(
        makeJob('whatsapp', {
          data: {
            payload: {
              ...BASE_JOB_DATA.payload,
              data: { templateVars: ['Suresh Kumar'], documentKey: 'resumes/c1/r.pdf' },
            },
          },
        }),
      );

      expect(waSendSpy.mock.calls[0]?.[2].document.filename).toBe('document.pdf');
    });

    it('FAILS when the document cannot be read — never sends a bodiless doc template', async () => {
      storageGetSpy.mockResolvedValue(null);
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'email-1' });

      await expect(
        processor.process(
          makeJob('whatsapp', {
            data: {
              payload: {
                ...BASE_JOB_DATA.payload,
                data: { templateVars: ['Suresh Kumar'], documentKey: 'resumes/missing.pdf' },
              },
            },
          }),
        ),
      ).rejects.toThrow(/document/i);

      expect(waSendSpy).not.toHaveBeenCalled();
      expect(prismaMock.getWaMsgRow()?.['errorCode']).toBe('DOCUMENT_UNAVAILABLE');
    });
  });

  // ── Email attachments (the resume PDF) ──────────────────────────────────────

  /**
   * THE BUG THIS BLOCK EXISTS FOR: `attachments` was a reserved key on the email
   * port that every adapter honoured, and NOTHING EVER SET IT — consumers with
   * no producer. So the resume email said "Your resume PDF is attached" and
   * arrived empty, on both the email-to-self endpoint and the
   * whatsappCapable→email downgrade, after the API had already answered
   * `delivered: 'EMAIL_FALLBACK'`.
   *
   * Nothing caught it because every existing email test asserted only THAT a
   * send happened, never WHAT it carried. These assert the payload.
   */
  describe('email attachments', () => {
    const DOC_DATA = {
      templateVars: ['Suresh Kumar'],
      documentKey: 'resumes/c1/r.pdf',
      documentFilename: 'Suresh-Kumar-Resume.pdf',
    };

    /** payload the email channel was actually handed. */
    const sentPayload = () =>
      emailSendSpy.mock.calls[0]?.[2] as { attachments?: { filename: string; content: Buffer; contentType: string }[] };

    it('the whatsappCapable DOWNGRADE attaches the PDF', async () => {
      // The path the API already promised as EMAIL_FALLBACK.
      await buildProcessor({ whatsappCapable: false, phone: PHONE });
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'e-1' });

      await processor.process(
        makeJob('whatsapp', {
          data: { payload: { ...BASE_JOB_DATA.payload, data: DOC_DATA } },
        }),
      );

      const att = sentPayload()?.attachments;
      expect(att).toHaveLength(1);
      expect(att![0]!.filename).toBe('Suresh-Kumar-Resume.pdf');
      expect(att![0]!.content.length).toBeGreaterThan(0);
      expect(att![0]!.contentType).toBe('application/pdf');
    });

    it('the DIRECT email path attaches the PDF (email-to-self)', async () => {
      await buildProcessor({ whatsappCapable: true, phone: PHONE });
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'e-2' });

      await processor.process(
        makeJob('email', {
          data: { payload: { ...BASE_JOB_DATA.payload, data: DOC_DATA } },
        }),
      );

      expect(sentPayload()?.attachments?.[0]?.filename).toBe('Suresh-Kumar-Resume.pdf');
    });

    it('the FAILURE-fallback attaches the PDF too', async () => {
      await buildProcessor({ whatsappCapable: true, phone: PHONE });
      waSendSpy.mockRejectedValue(new Error('Meta API error'));
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'e-3' });

      await expect(
        processor.process(
          makeJob(
            'whatsapp',
            { attemptsMade: 2, opts: { attempts: 3 },
              data: { payload: { ...BASE_JOB_DATA.payload, data: DOC_DATA } } },
          ),
        ),
      ).rejects.toThrow();

      expect(sentPayload()?.attachments?.[0]?.filename).toBe('Suresh-Kumar-Resume.pdf');
    });

    it('a notification with NO document sends NO attachments key', async () => {
      // Every other notification type must be byte-for-byte unaffected.
      await buildProcessor({ whatsappCapable: true, phone: PHONE });
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'e-4' });

      await processor.process(makeJob('email'));

      expect(sentPayload()).not.toHaveProperty('attachments');
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('an UNREADABLE document fails the send — never an email claiming an attachment', async () => {
      // The whole point. Sending anyway would reproduce the exact bug: a body
      // that says "attached" with nothing attached, recorded as SENT.
      await buildProcessor({ whatsappCapable: true, phone: PHONE });
      storageGetSpy.mockResolvedValue(null);
      emailSendSpy.mockResolvedValue({ ok: true, providerMessageId: 'e-5' });

      await expect(
        processor.process(
          makeJob('email', {
            data: { payload: { ...BASE_JOB_DATA.payload, data: DOC_DATA } },
          }),
        ),
      ).rejects.toThrow(/attachment/i);

      expect(emailSendSpy).not.toHaveBeenCalled();
    });
  });
});

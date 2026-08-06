/**
 * CR-WA W2 — the delivery-status webhook. ⚠️ CODEOWNERS review.
 *
 * A new PUBLIC, UNAUTHENTICATED endpoint whose only defence is an HMAC. What
 * these tests defend, in order of how expensive each is to get wrong:
 *
 *  1. SIGNATURE — a body that fails must never be parsed, and a missing secret
 *     must fail CLOSED rather than accept everything.
 *  2. THE HANDSHAKE — the challenge is echoed BARE. Wrapping it in this
 *     codebase's `{ data }` envelope fails Meta's verbatim comparison, with a
 *     dashboard error that looks like a wrong URL.
 *  3. ORDERING — Meta does not guarantee it and retries hard. A late 'sent'
 *     must not regress a 'delivered', or the row claims LESS than we know.
 *  4. UNKNOWN IDS ARE 200 — a 4xx teaches Meta to retry forever and tells a
 *     prober what exists.
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

const VERIFY_TOKEN = 'verify-me-123';
const APP_SECRET = 'app-secret-xyz';
const WAMID = 'wamid.ABC';

function sign(raw: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;
}

function statusPayload(id: string, status: string, errors?: unknown[]): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id, status, ...(errors ? { errors } : {}) }] } }] }],
  });
}

/** A request whose body is the raw Buffer, as the scoped parser delivers it. */
function req(raw: string, signature?: string): never {
  return {
    body: Buffer.from(raw),
    headers: { 'x-hub-signature-256': signature },
  } as never;
}

describe('WhatsApp delivery webhook', () => {
  let controller: WhatsappWebhookController;
  let service: WhatsappWebhookService;
  const updateMany = jest.fn();
  const findFirst = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue({ id: 'row-1' });

    const env: Record<string, string> = {
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_APP_SECRET: APP_SECRET,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        WhatsappWebhookService,
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
        { provide: PrismaService, useValue: { whatsappMessage: { updateMany, findFirst } } },
      ],
    }).compile();

    controller = moduleRef.get(WhatsappWebhookController);
    service = moduleRef.get(WhatsappWebhookService);
  });

  // ── 1. Signature ──────────────────────────────────────────────────────────

  describe('signature — verified BEFORE parsing', () => {
    it('a valid signature is processed', async () => {
      const raw = statusPayload(WAMID, 'delivered');
      await expect(controller.receive(req(raw, sign(raw)))).resolves.toEqual({ received: true });
    });

    it('a TAMPERED body is rejected 401', async () => {
      const raw = statusPayload(WAMID, 'delivered');
      const signature = sign(raw);
      const tampered = statusPayload('wamid.EVIL', 'read');
      await expect(controller.receive(req(tampered, signature))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a MISSING signature header is rejected 401', async () => {
      const raw = statusPayload(WAMID, 'sent');
      await expect(controller.receive(req(raw))).rejects.toThrow(UnauthorizedException);
    });

    it('a malformed header (no sha256= prefix) is rejected', () => {
      expect(service.verifySignature(Buffer.from('{}'), 'deadbeef')).toBe(false);
    });

    it('THE BODY IS NEVER PARSED on rejection', async () => {
      // Deliberately not valid JSON: if the handler parsed before verifying,
      // this would surface as a SyntaxError rather than a clean 401.
      const notJson = '<html>nope';
      await expect(controller.receive(req(notJson, 'sha256=bad'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('a MISSING app secret FAILS CLOSED — it never means "accept unsigned"', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          WhatsappWebhookService,
          { provide: ConfigService, useValue: { get: () => undefined } },
          { provide: PrismaService, useValue: { whatsappMessage: { updateMany, findFirst } } },
        ],
      }).compile();
      const bare = moduleRef.get(WhatsappWebhookService);
      const raw = statusPayload(WAMID, 'sent');
      expect(bare.verifySignature(Buffer.from(raw), sign(raw))).toBe(false);
    });
  });

  // ── 2. Handshake ──────────────────────────────────────────────────────────

  describe('subscription handshake', () => {
    it('echoes the challenge VERBATIM when the token matches', () => {
      // Bare string. Meta compares the response body byte-for-byte; wrapping it
      // in { data } is the failure that looks like a wrong URL in the dashboard.
      expect(controller.verify('subscribe', VERIFY_TOKEN, 'CHALLENGE-9')).toBe('CHALLENGE-9');
    });

    it('rejects a WRONG token with 403', () => {
      expect(() => controller.verify('subscribe', 'not-it', 'CHALLENGE-9')).toThrow(
        ForbiddenException,
      );
    });

    it('rejects a wrong mode', () => {
      expect(() => controller.verify('unsubscribe', VERIFY_TOKEN, 'C')).toThrow(ForbiddenException);
    });

    it('rejects missing params', () => {
      expect(() => controller.verify('subscribe', VERIFY_TOKEN, undefined as never)).toThrow(
        ForbiddenException,
      );
    });

    it('rejects when the verify token is not configured at all', () => {
      expect(service.verifyHandshake('subscribe', '', 'C')).toBeNull();
    });
  });

  // ── 3. Status mapping + ordering ──────────────────────────────────────────

  describe('status extraction', () => {
    it.each([
      ['sent', DeliveryStatus.SENT],
      ['delivered', DeliveryStatus.DELIVERED],
      ['read', DeliveryStatus.READ],
      ['failed', DeliveryStatus.FAILED],
    ])('maps %s', (meta, expected) => {
      const [update] = service.extractStatuses(JSON.parse(statusPayload(WAMID, meta)));
      expect(update?.status).toBe(expected);
    });

    it('captures the failure CODE only — never the human title (it can echo the number)', () => {
      const payload = JSON.parse(
        statusPayload(WAMID, 'failed', [
          { code: 131047, title: 'Message failed to send to +919876543210' },
        ]),
      );
      const [update] = service.extractStatuses(payload);
      expect(update?.errorCode).toBe('META_131047');
      expect(JSON.stringify(update)).not.toContain('9876543210');
    });

    it('ignores an INBOUND message payload — statuses only at MVP', () => {
      const inbound = { entry: [{ changes: [{ value: { messages: [{ id: 'x', text: {} }] } }] }] };
      expect(service.extractStatuses(inbound)).toEqual([]);
    });

    it.each([[null], [{}], [{ entry: 'nope' }], [{ entry: [{ changes: null }] }]])(
      'a malformed envelope %# yields no updates rather than throwing',
      (payload) => {
        expect(() => service.extractStatuses(payload)).not.toThrow();
        expect(service.extractStatuses(payload)).toEqual([]);
      },
    );

    it('lifts MULTIPLE statuses out of one batch', () => {
      const payload = {
        entry: [
          {
            changes: [
              { value: { statuses: [{ id: 'a', status: 'sent' }, { id: 'b', status: 'read' }] } },
            ],
          },
        ],
      };
      expect(service.extractStatuses(payload)).toHaveLength(2);
    });
  });

  describe('applying statuses — ordering and idempotency', () => {
    it('advances a row via a GUARDED update, not read-then-write', async () => {
      await service.applyStatuses([{ waMessageId: WAMID, status: DeliveryStatus.DELIVERED }]);

      const where = updateMany.mock.calls[0]?.[0]?.where;
      expect(where.waMessageId).toBe(WAMID);
      // Only rows strictly BELOW this rank are eligible — the decision and the
      // write are one atomic statement, so a retry race cannot regress it.
      expect(where.status.in).toEqual(
        expect.arrayContaining([DeliveryStatus.QUEUED, DeliveryStatus.SENT]),
      );
      expect(where.status.in).not.toContain(DeliveryStatus.READ);
    });

    it('OUT OF ORDER: a late "sent" cannot regress a delivered row', async () => {
      updateMany.mockResolvedValue({ count: 0 }); // nothing matched the rank guard
      const result = await service.applyStatuses([
        { waMessageId: WAMID, status: DeliveryStatus.SENT },
      ]);
      expect(result.ignored).toBe(1);
      expect(result.applied).toBe(0);
    });

    it('FAILED is terminal — it can overwrite any earlier optimistic status', async () => {
      await service.applyStatuses([{ waMessageId: WAMID, status: DeliveryStatus.FAILED }]);
      const eligible = updateMany.mock.calls[0]?.[0]?.where.status.in;
      expect(eligible).toEqual(
        expect.arrayContaining([DeliveryStatus.SENT, DeliveryStatus.DELIVERED, DeliveryStatus.READ]),
      );
    });

    it('REPLAY: the same callback twice leaves one row in one state', async () => {
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      const first = await service.applyStatuses([{ waMessageId: WAMID, status: DeliveryStatus.READ }]);
      const second = await service.applyStatuses([{ waMessageId: WAMID, status: DeliveryStatus.READ }]);
      expect(first.applied).toBe(1);
      expect(second.applied).toBe(0);
      expect(second.ignored).toBe(1);
    });

    it('records statusUpdatedAt from OUR clock, not the provider timestamp', async () => {
      await service.applyStatuses([{ waMessageId: WAMID, status: DeliveryStatus.DELIVERED }]);
      expect(updateMany.mock.calls[0]?.[0]?.data.statusUpdatedAt).toBeInstanceOf(Date);
    });

    it('an UNKNOWN message id is counted, not thrown', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      findFirst.mockResolvedValue(null);
      const result = await service.applyStatuses([
        { waMessageId: 'wamid.NEVER_SEEN', status: DeliveryStatus.DELIVERED },
      ]);
      expect(result.unknown).toBe(1);
    });

    it('one bad row does not abandon the rest of the batch', async () => {
      updateMany
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce({ count: 1 });
      const result = await service.applyStatuses([
        { waMessageId: 'a', status: DeliveryStatus.SENT },
        { waMessageId: 'b', status: DeliveryStatus.SENT },
      ]);
      expect(result.applied).toBe(1);
      expect(result.ignored).toBe(1);
    });
  });

  // ── 4. Always 200 once signed ─────────────────────────────────────────────

  describe('responds 200 once the signature passes', () => {
    it('an unknown message id still returns 200', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      findFirst.mockResolvedValue(null);
      const raw = statusPayload('wamid.NEVER_SEEN', 'delivered');
      // A 4xx would teach Meta to retry forever and tell a prober what exists.
      await expect(controller.receive(req(raw, sign(raw)))).resolves.toEqual({ received: true });
    });

    it('an inbound-message payload returns 200 and writes nothing', async () => {
      const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'x' }] } }] }] });
      await expect(controller.receive(req(raw, sign(raw)))).resolves.toEqual({ received: true });
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  it('a PARSED body (raw-body scoping regressed) fails loudly rather than silently', async () => {
    const parsed = { body: { entry: [] }, headers: {} } as never;
    await expect(controller.receive(parsed)).rejects.toThrow(/raw-body scoping is broken/i);
  });
});

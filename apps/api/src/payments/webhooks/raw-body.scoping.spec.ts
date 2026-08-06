/**
 * Raw-body scoping — the classic production-only failure, proven both ways:
 *
 *  1. The webhook route receives the UNTOUCHED raw Buffer (byte-identical to
 *     what was sent — the bytes signatures are computed over).
 *  2. A NORMAL route still JSON-parses (the regression the gotcha warns
 *     about: scoping the raw parser must not break everyone else).
 *
 * The test app mirrors main.api.ts exactly: bodyParser disabled at create,
 * applyScopedBodyParsers, the same global prefix + URI versioning — so the
 * paths the middleware is scoped to are the paths Nest actually serves.
 */
import { Body, Controller, INestApplication, Post, RequestMethod, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { applyScopedBodyParsers } from './raw-body.middleware';
import { WhatsappWebhookController } from '../../notifications/webhooks/whatsapp-webhook.controller';
import { WhatsappWebhookService } from '../../notifications/webhooks/whatsapp-webhook.service';

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: Record<string, unknown>): { parsed: boolean; body: Record<string, unknown> } {
    return { parsed: typeof body === 'object' && !Buffer.isBuffer(body), body };
  }
}

describe('raw-body scoping (mirrors main.api.ts bootstrap)', () => {
  let app: INestApplication;
  let processSpy: jest.Mock;
  /** Captured by the stub below so the WhatsApp path can assert on real bytes. */
  let whatsappRawBody: Buffer | null = null;

  beforeAll(async () => {
    processSpy = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController, EchoController, WhatsappWebhookController],
      providers: [
        { provide: WebhookService, useValue: { process: processSpy } },
        {
          provide: WhatsappWebhookService,
          useValue: {
            // Record what the controller was handed, then reject — this test is
            // about the BYTES reaching the handler, not about the signature.
            verifySignature: (raw: Buffer) => {
              whatsappRawBody = raw;
              return false;
            },
            extractStatuses: () => [],
            applyStatuses: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    applyScopedBodyParsers(app);
    app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => processSpy.mockClear());

  it('the webhook route receives the raw Buffer, byte-identical to the wire payload', async () => {
    // Non-pretty AND pretty JSON — a re-serialized (parsed→stringified) body
    // would lose the exact whitespace, which is precisely what breaks HMACs.
    const wire = '{\n  "event": "payment.captured",\n  "n": 1\n}';

    await supertest(app.getHttpServer())
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'sig-under-test')
      .send(wire)
      .expect(200);

    expect(processSpy).toHaveBeenCalledTimes(1);
    const [provider, rawBody] = processSpy.mock.calls[0]!;
    expect(provider).toBe('razorpay');
    expect(Buffer.isBuffer(rawBody)).toBe(true);
    expect((rawBody as Buffer).toString('utf8')).toBe(wire); // exact bytes
  });

  it('the stripe path is scoped too', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_1"}')
      .expect(200);
    expect(Buffer.isBuffer(processSpy.mock.calls[0]![1])).toBe(true);
  });

  it('the WHATSAPP path is scoped too (CR-WA W2)', async () => {
    // The catch this unit was written around: a new signed webhook whose path is
    // missing from WEBHOOK_RAW_PATHS gets a PARSED body, so its HMAC is computed
    // over the wrong thing. Unit tests construct the Buffer themselves and pass
    // regardless — only an HTTP-layer test can see it.
    const wire = '{"entry":[{"changes":[]}]}';

    await supertest(app.getHttpServer())
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=whatever')
      .send(wire)
      // 401: the signature is wrong, which is the CORRECT outcome here. What
      // matters is that it got far enough to be checked at all — a parsed body
      // would have thrown from rawBody() as a 500 instead.
      .expect(401);

    expect(whatsappRawBody).not.toBeNull();
    expect(Buffer.isBuffer(whatsappRawBody)).toBe(true);
    expect(whatsappRawBody!.toString('utf8')).toBe(wire);
  });

  it('REGRESSION: a normal API route still JSON-parses', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/echo')
      .send({ hello: 'world', n: 2 })
      .expect(201);
    expect(res.body).toEqual({ parsed: true, body: { hello: 'world', n: 2 } });
  });
});

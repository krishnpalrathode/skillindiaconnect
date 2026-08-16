/**
 * The handshake as META ACTUALLY SEES IT — status, headers and body bytes.
 *
 * WHY THIS EXISTS AT THE HTTP LAYER. The unit tests call `controller.verify()`
 * and assert on its RETURN VALUE. That can never see what Nest and Express do
 * with that value afterwards: which Content-Type is negotiated, whether the
 * string is JSON-serialised, or what the global exception filter does to a
 * rejection. Meta compares the response BODY verbatim and reports one generic
 * dashboard error for anything it dislikes, so the wire format is the contract
 * and it was previously untested.
 *
 * The app mirrors main.api.ts: global prefix, URI versioning, and the same
 * global HttpProblemFilter — because the bug this file pins was an INTERACTION
 * between `@Header()` on the handler and the filter's `res.json()`.
 */
import { INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { HttpProblemFilter } from '../../core/http-problem.filter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MetricsService } from '../../core/observability/metrics.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

const VERIFY_TOKEN = 'the-verify-token';
const BASE = '/api/v1/webhooks/whatsapp';

describe('WhatsApp handshake — the exact response Meta receives', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        WhatsappWebhookService,
        { provide: APP_FILTER, useClass: HttpProblemFilter },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => (k === 'WHATSAPP_VERIFY_TOKEN' ? VERIFY_TOKEN : undefined),
          },
        },
        { provide: PrismaService, useValue: { whatsappMessage: {} } },
        MetricsService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => app.close());

  describe('success', () => {
    it('200, text/plain, and the challenge BARE — no JSON, no { data } envelope', async () => {
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        })
        .expect(200);

      // Byte-for-byte. Meta compares the body verbatim; a wrapped or
      // re-serialised value fails verification with a generic dashboard error
      // that reads exactly like a wrong URL.
      expect(res.text).toBe('1158201444');
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      // Not `{"data":"…"}`, not `"1158201444"` with JSON quotes.
      expect(res.text).not.toContain('{');
      expect(res.text).not.toContain('"');
    });

    it('no leading/trailing whitespace and no BOM', async () => {
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': 'CHAL',
        })
        .expect(200);

      expect(res.text).toBe(res.text.trim());
      expect(res.text.charCodeAt(0)).not.toBe(0xfeff);
      expect(Buffer.from(res.text, 'utf8')).toEqual(Buffer.from('CHAL', 'utf8'));
    });

    it('a purely numeric challenge stays a STRING — never coerced to a number', async () => {
      // Meta documents hub.challenge as "an int you must pass back to us", and a
      // leading zero or a value beyond Number.MAX_SAFE_INTEGER would not survive
      // a round-trip through Number(). Echoing the raw string is what protects it.
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '00912345678901234567890',
        })
        .expect(200);

      expect(res.text).toBe('00912345678901234567890');
    });
  });

  describe('rejection', () => {
    /**
     * THE REGRESSION THIS FILE WAS WRITTEN FOR.
     *
     * `@Header('content-type', 'text/plain')` is applied BEFORE the handler
     * runs, so it survived into the exception filter — and `res.json()` only
     * DEFAULTS the header, it does not override one already set. Every
     * rejection from this route therefore went out as a JSON body labelled
     * `text/plain; charset=utf-8`. Reproduced against production before the fix.
     */
    it('an error body is labelled application/json, NOT the handler text/plain', async () => {
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'C' })
        .expect(403);

      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body.code).toBe('INVALID_VERIFY_TOKEN');
    });

    it('a MISSING hub.challenge is not misreported as a bad verify token', async () => {
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN })
        .expect(403);

      // Previously INVALID_VERIFY_TOKEN — which sent an operator to re-check the
      // one value that was already correct.
      expect(res.body.code).toBe('MISSING_HUB_PARAMS');
    });

    it('a wrong hub.mode names itself', async () => {
      const res = await supertest(app.getHttpServer())
        .get(BASE)
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': 'C',
        })
        .expect(403);

      expect(res.body.code).toBe('BAD_HUB_MODE');
    });
  });

  /**
   * Nest binds `@Query('hub.mode')` by literal key. If Express's query parser
   * were ever configured with qs `allowDots`, these would arrive nested under
   * `hub` and every parameter would read as undefined — turning a correct
   * deployment into a permanent MISSING_HUB_PARAMS with nothing to point at.
   */
  it('the dotted query keys bind literally', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${BASE}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=DOTTED`)
      .expect(200);

    expect(res.text).toBe('DOTTED');
  });
});

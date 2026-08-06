import { INestApplication } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';

/**
 * Scoped raw-byte capture for the webhook routes — the framework fight, won
 * once, here.
 *
 * MECHANISM (stated per the unit spec): Nest's default body parsing is
 * DISABLED at bootstrap (`NestFactory.create(..., { bodyParser: false })`)
 * and re-wired manually in this exact order:
 *
 *   1. `express.raw()` mounted ONLY on the two webhook paths — `req.body`
 *      becomes the UNTOUCHED Buffer of raw bytes. Signature verification
 *      runs on those exact bytes; `JSON.parse` happens only after it passes.
 *   2. `express.json()` + `express.urlencoded()` globally — every other
 *      route keeps normal JSON parsing, byte-for-byte identical to Nest's
 *      default behavior.
 *
 * Ordering is what makes the scoping airtight: body-parser sets `req._body`
 * once a parser has consumed the stream, so the global json parser SKIPS
 * requests the raw parser already captured — the webhook body is never
 * JSON-parsed by the framework at all.
 */
/**
 * Every SIGNED webhook path in the platform.
 *
 * ⚠️ A NEW SIGNED WEBHOOK MUST BE ADDED HERE. This is a bootstrap-level registry
 * (main.api.ts applies it before Nest routing exists), so it spans modules —
 * `whatsapp` is served by the notifications module, not payments. The list and
 * the controllers' routes have to AGREE, and nothing but a test can enforce
 * that: omit a path and the body arrives already JSON-parsed, `req.body` is not
 * a Buffer, and signature verification is computed over the wrong thing — or a
 * defensive Buffer check short-circuits and the request is processed UNVERIFIED.
 *
 * That failure is invisible to unit tests, which construct the Buffer
 * themselves. It is proven at the HTTP layer in raw-body.scoping.spec.ts, which
 * is the only place it can be.
 */
export const WEBHOOK_RAW_PATHS = [
  '/api/v1/webhooks/razorpay',
  '/api/v1/webhooks/stripe',
  '/api/v1/webhooks/whatsapp',
];

export function applyScopedBodyParsers(app: INestApplication): void {
  for (const path of WEBHOOK_RAW_PATHS) {
    // type: () => true — capture raw bytes regardless of Content-Type; the
    // gateway signs bytes, not media types. 1mb is far above any event size.
    app.use(path, raw({ type: () => true, limit: '1mb' }));
  }
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
}

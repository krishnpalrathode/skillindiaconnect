import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

/**
 * GET + POST /api/v1/webhooks/whatsapp — Meta delivery statuses (CR-WA W2).
 *
 * @Public: THE SIGNATURE IS THE AUTH. There is no bearer token on a provider
 * callout; the POST verifies an HMAC over the RAW bytes before anything is
 * parsed, exactly as the payments webhook does.
 *
 * @SkipThrottle: providers burst legitimately — Meta retries a batch after any
 * downtime of ours — and throttling turns a recovery into a retry loop. The
 * signature gate is the abuse control.
 *
 * ⚠️ `/api/v1/webhooks/whatsapp` MUST be listed in WEBHOOK_RAW_PATHS
 * (payments/webhooks/raw-body.middleware.ts). Without it express.json() eats the
 * body first, `req.body` is not a Buffer, and the HMAC is computed over the
 * wrong bytes. raw-body.scoping.spec.ts proves the two agree at the HTTP layer,
 * which is the only level at which that mistake is visible.
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WhatsappWebhookController {
  constructor(private readonly service: WhatsappWebhookService) {}

  /**
   * The subscription handshake. THE FIRST GET ON A WEBHOOK ROUTE in this API.
   *
   * ⚠️ THE CHALLENGE IS ECHOED BARE — not JSON, not inside the `{ data }`
   * envelope this codebase uses everywhere else. Meta compares the response body
   * VERBATIM against the value it sent; wrapping it fails verification with a
   * generic dashboard error that looks like a wrong token. The @Header and the
   * plain string return are load-bearing, not stylistic.
   */
  @Get('whatsapp')
  @HttpCode(HttpStatus.OK)
  @Header('content-type', 'text/plain; charset=utf-8')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const result = this.service.verifyHandshake(mode, token, challenge);
    if (!result.ok) {
      /**
       * 403 is what Meta expects for a refused subscription — but the CODE now
       * names which check failed. Meta's dashboard shows one generic error for
       * every rejection, so if the body does not say which, the only way to tell
       * a missing `hub.challenge` from a wrong token is to read server logs and
       * guess. `TOKEN_MISMATCH` keeps the original INVALID_VERIFY_TOKEN code so
       * the documented contract does not move.
       */
      throw new ForbiddenException({
        code: result.reason === 'TOKEN_MISMATCH' ? 'INVALID_VERIFY_TOKEN' : result.reason,
      });
    }
    return result.challenge;
  }

  /**
   * Delivery statuses.
   *
   * ALWAYS 200 once the signature passes — including for a message id we do not
   * recognise. A 4xx teaches Meta to retry forever and tells a prober what
   * exists; the payments webhook reasons identically about unknown orders.
   *
   * Status updates are cheap DB writes and are done INLINE: Meta retries on slow
   * responses, so enqueueing would trade a millisecond of work for a redelivery
   * storm. (Inbound message handling, if it ever lands, is different work and
   * belongs on the queue.)
   */
  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request): Promise<{ received: true }> {
    const raw = this.rawBody(req);

    // BEFORE ANY PARSING.
    if (!this.service.verifySignature(raw, req.headers['x-hub-signature-256'])) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE' });
    }

    // Only now is it safe to look at the contents.
    const payload: unknown = JSON.parse(raw.toString('utf8'));
    const updates = this.service.extractStatuses(payload);
    await this.service.applyStatuses(updates);

    return { received: true };
  }

  /** Defensive: a non-Buffer body means the raw-body scoping regressed. */
  private rawBody(req: Request): Buffer {
    if (!Buffer.isBuffer(req.body)) {
      throw new Error(
        'WhatsApp webhook received a parsed body — raw-body scoping is broken. ' +
          "Add '/api/v1/webhooks/whatsapp' to WEBHOOK_RAW_PATHS (raw-body.middleware.ts).",
      );
    }
    return req.body;
  }
}

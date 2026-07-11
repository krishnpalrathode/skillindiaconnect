import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookService } from './webhook.service';

/**
 * POST /api/v1/webhooks/razorpay + /api/v1/webhooks/stripe — server-to-server.
 *
 * @Public: THE SIGNATURE IS THE AUTH — there is no bearer token on a gateway
 * callout; WebhookService verifies the HMAC/constructEvent against the RAW
 * bytes before anything else happens.
 *
 * @SkipThrottle: gateways burst legitimately (retry storms after our
 * downtime); throttling them turns a recovery into a retry loop. The
 * signature gate is the abuse control.
 *
 * `req.body` is the UNTOUCHED Buffer — raw-body.middleware.ts scopes
 * express.raw() to exactly these two paths (bodyParser: false at bootstrap).
 * Responses are 200-fast: replays, no-ops, and unknown orders are all 200 —
 * a 4xx teaches the gateway to retry forever and a prober what exists.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('razorpay')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async razorpay(@Req() req: Request): Promise<{ received: true }> {
    await this.webhookService.process('razorpay', this.rawBody(req), req.headers);
    return { received: true };
  }

  @Post('stripe')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async stripe(@Req() req: Request): Promise<{ received: true }> {
    await this.webhookService.process('stripe', this.rawBody(req), req.headers);
    return { received: true };
  }

  /** Defensive: a non-Buffer body means the raw-body scoping regressed. */
  private rawBody(req: Request): Buffer {
    if (!Buffer.isBuffer(req.body)) {
      throw new Error(
        'Webhook route received a parsed body — raw-body scoping is broken (see raw-body.middleware.ts).',
      );
    }
    return req.body;
  }
}

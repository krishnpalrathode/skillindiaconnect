import { Module } from '@nestjs/common';
import { WHATSAPP_CHANNEL } from './whatsapp.channel';
import { MockWhatsappChannel } from './whatsapp.mock';
import { createWhatsappChannelProvider } from './whatsapp-channel.factory';
import { EMAIL_CHANNEL } from './email.channel';
import { MockEmailChannel } from './email.mock';
import { createEmailChannelProvider } from './email-channel.factory';
import { BOUNCE_HANDLER, NoopBounceHandler } from './bounce-handler.port';

/**
 * Unified channel bindings for both WhatsApp and Email.
 *
 * WhatsApp: WHATSAPP_CHANNEL → MockWhatsappChannel (swaps to the Meta adapter
 * when the auth template is approved).
 *
 * Email: EMAIL_CHANNEL is bound by the config-driven factory
 * (email-channel.factory.ts), selecting mock | titan | ses via EMAIL_PROVIDER —
 * no code edit per environment, one line to add SES later. MockEmailChannel
 * stays a concrete provider so the factory can reuse its instance for `mock`
 * and tests can inject it directly.
 *
 * BOUNCE_HANDLER → NoopBounceHandler: the documented deferral (Titan has no
 * structured bounce stream; SES fills this seam later — bounce-handler.port.ts).
 *
 * This module is imported ONLY by the notification WORKER module, so the Titan
 * SMTP transport is constructed worker-side only — never in the API process.
 */
@Module({
  providers: [
    MockWhatsappChannel,
    // CR-WA W1: config-driven, and the SAME factory whatsapp.module.ts uses.
    // The two bindings must never diverge — see whatsapp-channel.factory.ts.
    createWhatsappChannelProvider(),
    MockEmailChannel,
    createEmailChannelProvider(),
    { provide: BOUNCE_HANDLER, useClass: NoopBounceHandler },
  ],
  exports: [WHATSAPP_CHANNEL, EMAIL_CHANNEL, BOUNCE_HANDLER, MockWhatsappChannel, MockEmailChannel],
})
export class ChannelsModule {}

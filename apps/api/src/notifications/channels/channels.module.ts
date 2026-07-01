import { Module } from '@nestjs/common';
import { WHATSAPP_CHANNEL } from './whatsapp.channel';
import { MockWhatsappChannel } from './whatsapp.mock';
import { EMAIL_CHANNEL } from './email.channel';
import { MockEmailChannel } from './email.mock';

/**
 * Unified channel bindings for both WhatsApp and Email.
 *
 * MVP bindings (both mocks):
 *   WHATSAPP_CHANNEL → MockWhatsappChannel
 *   EMAIL_CHANNEL    → MockEmailChannel
 *
 * Production swap (S8) — one line per channel, zero service/processor change:
 *   { provide: WHATSAPP_CHANNEL, useClass: MetaWhatsappChannel }   // when Meta templates approved
 *   { provide: EMAIL_CHANNEL,    useClass: SesEmailAdapter }        // when SES production approved
 *
 * NotificationProcessor injects both tokens without knowing the underlying implementation.
 */
@Module({
  providers: [
    MockWhatsappChannel,
    { provide: WHATSAPP_CHANNEL, useClass: MockWhatsappChannel },
    MockEmailChannel,
    { provide: EMAIL_CHANNEL, useClass: MockEmailChannel },
  ],
  exports: [WHATSAPP_CHANNEL, EMAIL_CHANNEL, MockWhatsappChannel, MockEmailChannel],
})
export class ChannelsModule {}

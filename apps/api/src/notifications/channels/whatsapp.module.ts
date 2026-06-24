import { Module } from '@nestjs/common';
import { WHATSAPP_CHANNEL } from './whatsapp.channel';
import { MockWhatsappChannel } from './whatsapp.mock';

/**
 * Provides WHATSAPP_CHANNEL → MockWhatsappChannel for MVP.
 *
 * Once the Meta WhatsApp auth template is approved, swap to the real adapter
 * with a single provider change here — no OtpService change required:
 *   { provide: WHATSAPP_CHANNEL, useClass: MetaWhatsappChannel }
 */
@Module({
  providers: [MockWhatsappChannel, { provide: WHATSAPP_CHANNEL, useClass: MockWhatsappChannel }],
  exports: [WHATSAPP_CHANNEL],
})
export class WhatsappModule {}

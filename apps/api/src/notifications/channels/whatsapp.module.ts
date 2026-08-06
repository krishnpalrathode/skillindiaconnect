import { Module } from '@nestjs/common';
import { WHATSAPP_CHANNEL } from './whatsapp.channel';
import { MockWhatsappChannel } from './whatsapp.mock';
import { createWhatsappChannelProvider } from './whatsapp-channel.factory';

/**
 * WHATSAPP_CHANNEL for the API PROCESS.
 *
 * Imported by AuthModule, so this is the binding OtpService.sendOtp uses — the
 * login/signup code, sent INLINE on the request path. That inline send is the
 * documented third exception in worker-and-external-sends.md: the user is at the
 * code-entry box, and `notOnWhatsapp` is only knowable from Meta's response, so
 * it can only be returned synchronously.
 *
 * ⚠️ THE SECOND BINDING IS channels.module.ts (worker). Both use the SAME
 * factory. Converting one without the other is the silent failure this
 * arrangement prevents — swapping only the worker would send notifications for
 * real while every OTP quietly went to the mock.
 */
@Module({
  providers: [MockWhatsappChannel, createWhatsappChannelProvider()],
  exports: [WHATSAPP_CHANNEL, MockWhatsappChannel],
})
export class WhatsappModule {}

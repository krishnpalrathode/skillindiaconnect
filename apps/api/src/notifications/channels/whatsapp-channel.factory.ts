import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WHATSAPP_CHANNEL, WhatsappChannel } from './whatsapp.channel';
import { MockWhatsappChannel } from './whatsapp.mock';
import { MetaWhatsappChannel } from './meta-whatsapp.channel';

export type WhatsappProvider = 'meta' | 'mock';

/**
 * Config-driven WHATSAPP_CHANNEL binding (CR-WA W1) — mirroring
 * email-channel.factory.ts, so the choice is `WHATSAPP_PROVIDER` (env) rather
 * than a code edit per environment:
 *
 *   WHATSAPP_PROVIDER=mock → MockWhatsappChannel (dev/test/CI; the DEFAULT)
 *   WHATSAPP_PROVIDER=meta → MetaWhatsappChannel (production)
 *
 * ⚠️ THIS FACTORY MUST BE USED IN BOTH MODULES THAT BIND WHATSAPP_CHANNEL:
 *
 *   whatsapp.module.ts → the API process   (AuthModule → OtpService.sendOtp)
 *   channels.module.ts → the WORKER process (notification sends)
 *
 * Converting only one is the failure this factory exists to prevent: with just
 * channels.module.ts swapped, notifications would send for real while every
 * login OTP silently went to the mock — no error, no log, no message. That the
 * two bindings share ONE factory is what makes them impossible to diverge, and
 * a spec asserts both resolve to the same class.
 *
 * `mock` is the ROLLBACK. Flip the env var and restart; no deploy, no code
 * change. It is also the default, so an unset variable degrades to "sends
 * nothing" rather than "sends with missing credentials".
 *
 * The `mock` branch reuses the EXISTING MockWhatsappChannel provider instance so
 * tests that inject MockWhatsappChannel and WHATSAPP_CHANNEL see the same send
 * log (the same reason email-channel.factory.ts does it).
 */
export function createWhatsappChannelProvider(): Provider {
  return {
    provide: WHATSAPP_CHANNEL,
    inject: [ConfigService, MockWhatsappChannel],
    useFactory: (config: ConfigService, mock: MockWhatsappChannel): WhatsappChannel => {
      const provider = (config.get<string>('WHATSAPP_PROVIDER') ?? 'mock') as WhatsappProvider;
      switch (provider) {
        case 'mock':
          return mock;
        case 'meta':
          // Constructed here — throws loudly if WHATSAPP_ACCESS_TOKEN /
          // WHATSAPP_PHONE_NUMBER_ID are missing, or if a whatsapp-tier
          // notification type has no approved template mapped.
          return new MetaWhatsappChannel(config);
        default:
          throw new Error(
            `Unknown WHATSAPP_PROVIDER '${provider}' — expected 'meta' or 'mock'.`,
          );
      }
    },
  };
}

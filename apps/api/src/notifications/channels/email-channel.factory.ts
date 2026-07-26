import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_CHANNEL, EmailChannel } from './email.channel';
import { MockEmailChannel } from './email.mock';
import { TitanSmtpEmailChannel } from './titan-smtp-email.channel';

export type EmailProvider = 'titan' | 'ses' | 'mock';

/**
 * Config-driven EMAIL_CHANNEL binding — the same pattern the WhatsApp channel
 * uses, lifted to a factory so the choice is `EMAIL_PROVIDER` (env) rather than
 * a code edit per environment:
 *
 *   EMAIL_PROVIDER=mock   → MockEmailChannel   (dev/test/CI; the default)
 *   EMAIL_PROVIDER=titan  → TitanSmtpEmailChannel (production email via Titan)
 *   EMAIL_PROVIDER=ses    → not built yet — throws a self-documenting error
 *
 * The `mock` binding reuses the EXISTING MockEmailChannel provider instance (so
 * tests that inject MockEmailChannel and EMAIL_CHANNEL see the same send log).
 *
 * ── WHERE THE SES ADAPTER SLOTS IN ──────────────────────────────────────────
 * Add `SesEmailChannel implements EmailChannel` (email.channel.ts, UNCHANGED),
 * add a `case 'ses'` returning it, wire its SNS bounce subscriber to the
 * BounceHandler seam (bounce-handler.port.ts). That is the ENTIRE migration:
 * no interface change, no caller change, no processor change — only this one
 * `case` and the new adapter file. The throw below states exactly this so the
 * seam is self-documenting at the point someone reaches for SES.
 */
export function createEmailChannelProvider(): Provider {
  return {
    provide: EMAIL_CHANNEL,
    inject: [ConfigService, MockEmailChannel],
    useFactory: (config: ConfigService, mock: MockEmailChannel): EmailChannel => {
      const provider = (config.get<string>('EMAIL_PROVIDER') ?? 'mock') as EmailProvider;
      switch (provider) {
        case 'mock':
          return mock;
        case 'titan':
          // Constructed here (worker-only module) — throws loudly if the
          // TITAN_SMTP_* / EMAIL_FROM secrets are missing.
          return new TitanSmtpEmailChannel(config);
        case 'ses':
          throw new Error(
            "EMAIL_PROVIDER='ses' — the SES adapter is not implemented yet. " +
              'Adding it requires NO interface or caller change: create ' +
              'SesEmailChannel implementing EmailChannel (see email.channel.ts), ' +
              "return it from a 'case \"ses\"' here, and wire its SNS bounce " +
              'stream to the BounceHandler seam (see bounce-handler.port.ts).',
          );
        default:
          throw new Error(
            `Unknown EMAIL_PROVIDER '${provider}' — expected 'titan', 'ses', or 'mock'.`,
          );
      }
    },
  };
}

/**
 * CR-WA W1 — BOTH bindings convert. This is the regression guard for the exact
 * defect the first draft of this unit contained.
 *
 * WHATSAPP_CHANNEL is bound in TWO modules, in TWO processes:
 *   whatsapp.module.ts → API    (AuthModule → OtpService.sendOtp, inline)
 *   channels.module.ts → WORKER (notification sends)
 *
 * Converting only channels.module.ts — the obvious single swap — leaves the API
 * on MockWhatsappChannel. Notifications then send for real while EVERY LOGIN OTP
 * silently sends nothing: no error, no log, no message. The smoke test fails
 * with no visible cause.
 *
 * These tests RESOLVE the token from a real Nest container rather than reading
 * source, because source inspection is precisely how that class of error
 * survives review — you read one module, see the binding, and never learn the
 * second exists.
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { WHATSAPP_CHANNEL } from './whatsapp.channel';
import { WhatsappModule } from './whatsapp.module';
import { ChannelsModule } from './channels.module';
import { MockWhatsappChannel } from './whatsapp.mock';
import { MetaWhatsappChannel } from './meta-whatsapp.channel';

const META_ENV: Record<string, unknown> = {
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_ACCESS_TOKEN: 'tok',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  WHATSAPP_GRAPH_VERSION: 'v21.0',
  WHATSAPP_TIMEOUT_MS: 5000,
};

/**
 * Resolve WHATSAPP_CHANNEL out of a REAL Nest container for the given module.
 *
 * ConfigModule is loaded as GLOBAL because that is how it exists in the running
 * app (AppConfigModule) — neither WhatsappModule nor ChannelsModule imports it
 * explicitly, so an isolated container without it would fail to resolve for a
 * reason that has nothing to do with what is under test.
 */
async function resolveFrom(
  module: typeof WhatsappModule | typeof ChannelsModule,
  env: Record<string, unknown>,
): Promise<unknown> {
  const ref = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] }),
      module,
    ],
  }).compile();
  return ref.get(WHATSAPP_CHANNEL);
}

describe('WHATSAPP_CHANNEL — both bindings, resolved from real containers', () => {
  it('API module (whatsapp.module) binds the META adapter when provider=meta', async () => {
    expect(await resolveFrom(WhatsappModule, META_ENV)).toBeInstanceOf(MetaWhatsappChannel);
  });

  it('WORKER module (channels.module) binds the META adapter when provider=meta', async () => {
    expect(await resolveFrom(ChannelsModule, META_ENV)).toBeInstanceOf(MetaWhatsappChannel);
  });

  it('BOTH resolve to the SAME class — they can never diverge', async () => {
    const api = await resolveFrom(WhatsappModule, META_ENV);
    const worker = await resolveFrom(ChannelsModule, META_ENV);
    expect(api!.constructor).toBe(worker!.constructor);
  });
});

describe('the default is the SAFE one', () => {
  it.each([
    ['whatsapp.module (API)', WhatsappModule],
    ['channels.module (worker)', ChannelsModule],
  ])('%s falls back to the MOCK when WHATSAPP_PROVIDER is unset', async (_label, mod) => {
    // An unset variable must mean "sends nothing", never "sends with missing
    // credentials" — and mock is the documented rollback.
    expect(await resolveFrom(mod as typeof WhatsappModule, {})).toBeInstanceOf(MockWhatsappChannel);
  });

  it('an unknown provider THROWS rather than guessing', async () => {
    await expect(resolveFrom(WhatsappModule, { WHATSAPP_PROVIDER: 'twilio' })).rejects.toThrow(
      /unknown whatsapp_provider/i,
    );
  });
});

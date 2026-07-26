/**
 * Config-driven EMAIL_PROVIDER selection — the same discipline as the WhatsApp
 * channel, and the self-documenting SES deferral.
 */
import { ConfigService } from '@nestjs/config';
import { createEmailChannelProvider } from './email-channel.factory';
import { MockEmailChannel } from './email.mock';
import { TitanSmtpEmailChannel } from './titan-smtp-email.channel';
import { EmailChannel } from './email.channel';

type FactoryProvider = { useFactory: (...a: unknown[]) => EmailChannel; inject: unknown[] };

function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function build(values: Record<string, unknown>, mock = new MockEmailChannel()): EmailChannel {
  const provider = createEmailChannelProvider() as unknown as FactoryProvider;
  return provider.useFactory(configStub(values), mock);
}

describe('createEmailChannelProvider — EMAIL_PROVIDER selection', () => {
  it('EMAIL_PROVIDER unset → mock (the safe default)', () => {
    expect(build({})).toBeInstanceOf(MockEmailChannel);
  });

  it('EMAIL_PROVIDER=mock → the SAME MockEmailChannel instance is reused', () => {
    const mock = new MockEmailChannel();
    expect(build({ EMAIL_PROVIDER: 'mock' }, mock)).toBe(mock);
  });

  it('EMAIL_PROVIDER=titan → the Titan adapter (with valid config)', () => {
    const channel = build({
      EMAIL_PROVIDER: 'titan',
      TITAN_SMTP_HOST: 'smtp.titan.email',
      TITAN_SMTP_PORT: 587,
      TITAN_SMTP_USER: 'noreply@skillindiaconnect.com',
      TITAN_SMTP_PASS: 'secret',
      EMAIL_FROM: 'noreply@skillindiaconnect.com',
    });
    expect(channel).toBeInstanceOf(TitanSmtpEmailChannel);
  });

  it('EMAIL_PROVIDER=titan with missing secrets → throws loudly at selection', () => {
    expect(() => build({ EMAIL_PROVIDER: 'titan' })).toThrow(/Titan email is not configured/);
  });

  it('EMAIL_PROVIDER=ses → a self-documenting not-implemented error (the seam is stated)', () => {
    expect(() => build({ EMAIL_PROVIDER: 'ses' })).toThrow(/SES adapter is not implemented/);
    // The error names WHERE the SES adapter slots in and that no caller changes.
    expect(() => build({ EMAIL_PROVIDER: 'ses' })).toThrow(/no interface or caller change/i);
  });

  it('an unknown EMAIL_PROVIDER → a clear error (never a silent wrong default)', () => {
    expect(() => build({ EMAIL_PROVIDER: 'sendgrid' })).toThrow(/Unknown EMAIL_PROVIDER/);
  });
});

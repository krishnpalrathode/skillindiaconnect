/**
 * Resend adapter — tested through the `post` seam, which captures the exact
 * wire payload and simulates provider responses. No network, no API key.
 *
 * Mirrors titan-smtp-email.channel.spec.ts case for case: the two adapters
 * implement the SAME port, so they owe the same guarantees (FROM-as-config,
 * attachments, failure honesty, redaction, loud misconfiguration).
 *
 * The real-Resend send is a documented GO-LIVE smoke step, not an automated test.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResendEmailChannel, type ResendResponse } from './resend-email.channel';
import { EmailAttachment } from './email.channel';

const FROM = 'noreply@skillindiaconnect.com';

function configStub(over: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: FROM,
    ...over,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

type CapturedPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; content_type: string }>;
};

/** Captures the built payload and returns a scripted provider response. */
class StubResend extends ResendEmailChannel {
  last?: CapturedPayload;
  response: ResendResponse = { status: 200, body: { id: 'resend-msg-1' } };
  throwOnPost?: Error;

  protected async post(body: CapturedPayload): Promise<ResendResponse> {
    this.last = body;
    if (this.throwOnPost) throw this.throwOnPost;
    return this.response;
  }
}

describe('ResendEmailChannel', () => {
  it('a basic send reaches the provider → SENT + a providerMessageId', async () => {
    const ch = new StubResend(configStub());
    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe('resend-msg-1');
    // Resend takes an ARRAY of recipients.
    expect(ch.last?.to).toEqual(['worker@example.com']);
    expect(ch.last?.subject).toBeTruthy();
  });

  it('FROM defaults to EMAIL_FROM (config-as-sender) when the call omits it', async () => {
    const ch = new StubResend(configStub());
    await ch.send('worker@example.com', 'PASSPORT_EXPIRY', {});
    expect(ch.last?.from).toBe(FROM);
  });

  it('an explicit payload.from OVERRIDES the config sender', async () => {
    const ch = new StubResend(configStub());
    await ch.send('worker@example.com', 'PASSPORT_EXPIRY', {
      from: 'alerts@skillindiaconnect.com',
    });
    expect(ch.last?.from).toBe('alerts@skillindiaconnect.com');
  });

  it('ATTACHMENT support: a PDF (the resume case) is base64-encoded onto the wire', async () => {
    const ch = new StubResend(configStub());
    const bytes = Buffer.from('%PDF-1.4 fake resume bytes');
    const pdf: EmailAttachment = {
      filename: 'resume.pdf',
      content: bytes,
      contentType: 'application/pdf',
    };
    const result = await ch.send('worker@example.com', 'RESUME_SENT', { attachments: [pdf] });

    expect(result.ok).toBe(true);
    expect(ch.last?.attachments).toHaveLength(1);
    expect(ch.last?.attachments?.[0]).toEqual({
      filename: 'resume.pdf',
      content: bytes.toString('base64'),
      content_type: 'application/pdf',
    });
    // Round-trips back to the ORIGINAL bytes — not merely "some base64".
    const sent = ch.last?.attachments?.[0];
    if (!sent) throw new Error('no attachment was captured');
    expect(Buffer.from(sent.content, 'base64').equals(bytes)).toBe(true);
  });

  it('FAILURE HONESTY: a rejected API key → ok:false EAUTH (never a false SENT)', async () => {
    const ch = new StubResend(configStub());
    ch.response = {
      status: 401,
      body: { name: 'validation_error', message: 'API key is invalid' },
    };

    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EAUTH');
    expect(result.providerMessageId).toBeUndefined();
  });

  it.each([
    [422, 'INVALID_REQUEST'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_ERROR'],
    [418, 'HTTP_418'],
  ])('status %i maps to the coarse code %s', async (status, expected) => {
    const ch = new StubResend(configStub());
    ch.response = { status, body: undefined };
    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});
    expect(result).toMatchObject({ ok: false, errorCode: expected });
  });

  it('FAILURE HONESTY: a request that times out → ok:false ETIMEDOUT', async () => {
    const ch = new StubResend(configStub());
    // What AbortSignal.timeout rejects with.
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    ch.throwOnPost = timeout;

    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});
    expect(result).toMatchObject({ ok: false, errorCode: 'ETIMEDOUT' });
  });

  it('FAILURE HONESTY: DNS/network failure surfaces its code', async () => {
    const ch = new StubResend(configStub());
    const dns = new Error('getaddrinfo ENOTFOUND') as Error & { code?: string };
    dns.code = 'ENOTFOUND';
    ch.throwOnPost = dns;

    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});
    expect(result).toMatchObject({ ok: false, errorCode: 'ENOTFOUND' });
  });

  it('REDACTION: neither the recipient address nor the body appears in logs', async () => {
    const logs: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((msg: unknown) => void logs.push(String(msg)));

    const ch = new StubResend(configStub());
    await ch.send('secret.person@example.com', 'APPLICATION_SELECTED', {
      subject: 'Your OTP is 123456',
      text: 'sensitive body content',
    });

    const joined = logs.join('\n');
    expect(joined).not.toContain('secret.person@example.com');
    expect(joined).not.toContain('secret.person');
    expect(joined).not.toContain('sensitive body content');
    expect(joined).not.toContain('123456');
    // The domain + a hash MAY appear (that's the allowed correlation signal).
    expect(joined).toContain('example.com');

    spy.mockRestore();
  });

  it('REDACTION: a provider error body is never echoed into the result', async () => {
    const ch = new StubResend(configStub());
    ch.response = {
      status: 422,
      body: { name: 'validation_error', message: 'recipient secret.person@example.com invalid' },
    };

    const result = await ch.send('secret.person@example.com', 'APPLICATION_SELECTED', {});
    expect(result.errorCode).toBe('INVALID_REQUEST');
    expect(JSON.stringify(result)).not.toContain('secret.person');
  });

  it('construction FAILS LOUDLY when Resend config is missing (no silent black hole)', () => {
    expect(() => new StubResend(configStub({ RESEND_API_KEY: undefined }))).toThrow(
      /Resend email is not configured/,
    );
    expect(() => new StubResend(configStub({ EMAIL_FROM: undefined }))).toThrow(
      /Resend email is not configured/,
    );
  });
});

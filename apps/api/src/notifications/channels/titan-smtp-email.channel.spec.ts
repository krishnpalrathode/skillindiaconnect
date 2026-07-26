/**
 * Titan/Nodemailer adapter — tested against Nodemailer's STREAM transport
 * (buffers the real MIME, no network), which is the CI-safe "catcher." Proves
 * message-building, FROM-as-config, attachments, and failure honesty through
 * the real Nodemailer pipeline without touching Titan.
 *
 * The real-Titan send is a documented GO-LIVE smoke step (docs/cutover-titan-email.md),
 * not an automated test.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import { TitanSmtpEmailChannel } from './titan-smtp-email.channel';
import { EmailAttachment } from './email.channel';

const FROM = 'noreply@skillindiaconnect.com';

function configStub(over: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    TITAN_SMTP_HOST: 'smtp.titan.email',
    TITAN_SMTP_PORT: 465,
    TITAN_SMTP_USER: 'noreply@skillindiaconnect.com',
    TITAN_SMTP_PASS: 'secret',
    EMAIL_FROM: FROM,
    ...over,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

/**
 * A subclass that swaps the real pooled SMTP transport for a stream transport
 * (buffers the encoded MIME) and records the last mail options + MIME — the
 * test seam `createTransport` exists for exactly this.
 */
class StreamTitan extends TitanSmtpEmailChannel {
  lastMail?: SendMailOptions;
  lastMime?: string;
  forceThrow = false;
  forceReject = false;

  protected createTransport(): Transporter {
    const t = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const orig = t.sendMail.bind(t);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t as any).sendMail = async (opts: SendMailOptions) => {
      this.lastMail = opts;
      if (this.forceThrow) {
        const err = new Error('connection refused') as Error & { code?: string };
        err.code = 'ECONNECTION';
        throw err;
      }
      const info = (await orig(opts)) as { message?: Buffer; messageId?: string };
      this.lastMime = info.message?.toString('utf8');
      if (this.forceReject) return { ...info, accepted: [], rejected: [opts.to] };
      return { ...info, accepted: [opts.to], rejected: [] };
    };
    return t;
  }
}

describe('TitanSmtpEmailChannel', () => {
  it('a basic send reaches the transport → SENT + a providerMessageId', async () => {
    const ch = new StreamTitan(configStub());
    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBeTruthy();
    expect(ch.lastMail?.to).toBe('worker@example.com');
    // The MIME was actually built (subject present).
    expect(ch.lastMime).toContain('Subject:');
  });

  it('FROM defaults to EMAIL_FROM (config-as-sender) when the call omits it', async () => {
    const ch = new StreamTitan(configStub());
    await ch.send('worker@example.com', 'PASSPORT_EXPIRY', {});
    expect(ch.lastMail?.from).toBe(FROM);
    expect(ch.lastMime).toContain(`From: ${FROM}`);
  });

  it('an explicit payload.from OVERRIDES the config sender', async () => {
    const ch = new StreamTitan(configStub());
    await ch.send('worker@example.com', 'PASSPORT_EXPIRY', { from: 'alerts@skillindiaconnect.com' });
    expect(ch.lastMail?.from).toBe('alerts@skillindiaconnect.com');
  });

  it('ATTACHMENT support: a PDF attachment (the resume case) is in the sent message', async () => {
    const ch = new StreamTitan(configStub());
    const pdf: EmailAttachment = {
      filename: 'resume.pdf',
      content: Buffer.from('%PDF-1.4 fake resume bytes'),
      contentType: 'application/pdf',
    };
    const result = await ch.send('worker@example.com', 'RESUME_SENT', { attachments: [pdf] });

    expect(result.ok).toBe(true);
    // Present in the mail options...
    const atts = ch.lastMail?.attachments as Array<{ filename: string; contentType: string }>;
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ filename: 'resume.pdf', contentType: 'application/pdf' });
    // ...AND actually encoded into the MIME the transport built.
    expect(ch.lastMime).toContain('resume.pdf');
    expect(ch.lastMime).toContain('application/pdf');
  });

  it('FAILURE HONESTY: a thrown transport error → ok:false (never a false SENT)', async () => {
    const ch = new StreamTitan(configStub());
    ch.forceThrow = true;
    const result = await ch.send('worker@example.com', 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ECONNECTION');
    expect(result.providerMessageId).toBeUndefined();
  });

  it('FAILURE HONESTY: a per-recipient rejection → ok:false RECIPIENT_REJECTED', async () => {
    const ch = new StreamTitan(configStub());
    ch.forceReject = true;
    const result = await ch.send('bad@example.com', 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('RECIPIENT_REJECTED');
  });

  it('REDACTION: neither the recipient address nor the body appears in logs', async () => {
    const logs: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((msg: unknown) => void logs.push(String(msg)));

    const ch = new StreamTitan(configStub());
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

  it('construction FAILS LOUDLY when Titan config is missing (no silent black hole)', () => {
    expect(() => new StreamTitan(configStub({ TITAN_SMTP_HOST: undefined }))).toThrow(
      /Titan email is not configured/,
    );
    expect(() => new StreamTitan(configStub({ EMAIL_FROM: undefined }))).toThrow(
      /Titan email is not configured/,
    );
  });
});

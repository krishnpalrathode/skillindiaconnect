/**
 * CR-WA W1 — the Meta adapter.
 *
 * The two failure modes this unit has are both silent at build time and
 * expensive in production:
 *
 *  1. A THROW escaping into OtpService → a user requesting a login code gets a
 *     500 instead of the email/SMS fallback. They are locked out with no
 *     recourse. This is the exact regression option C was chosen to PREVENT.
 *  2. A WRONG TEMPLATE NAME → Meta rejects, the row is marked FAILED, the
 *     candidate is quietly emailed, and nobody learns the name was wrong.
 *
 * So: every rejection path is asserted to RESOLVE, and the approved names are
 * asserted as literal strings.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaWhatsappChannel } from './meta-whatsapp.channel';
import {
  META_OTP_TEMPLATE,
  META_TEMPLATES,
  assertTemplateMappingComplete,
  resolveMetaTemplate,
} from './meta-templates';

const PHONE = '+919876543210';
const OK_BODY = { messages: [{ id: 'wamid.TEST123' }] };

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    WHATSAPP_ACCESS_TOKEN: 'tok-secret',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_GRAPH_VERSION: 'v21.0',
    WHATSAPP_TIMEOUT_MS: 5000,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

/** A Response-alike whose json() behaviour we control. */
function res(status: number, body: unknown, opts?: { jsonThrows?: boolean }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: opts?.jsonThrows
      ? () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))
      : () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchSpy: jest.SpyInstance;
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url, init) => impl(String(url), init as RequestInit));
}

afterEach(() => {
  fetchSpy?.mockRestore();
  jest.restoreAllMocks();
});

// ── The mapping ──────────────────────────────────────────────────────────────

describe('template mapping — the literal approved names', () => {
  it('maps wa.selected → job_selected with THREE parameters', () => {
    // Asserted as a literal string: this test is what stands between a typo and
    // a silent production failure.
    expect(META_TEMPLATES['wa.selected'].name).toBe('job_selected');
    expect(META_TEMPLATES['wa.selected'].params).toBe(3);
  });

  it('maps wa.resume_doc → resume_generated with ONE parameter + a document', () => {
    expect(META_TEMPLATES['wa.resume_doc'].name).toBe('resume_generated');
    expect(META_TEMPLATES['wa.resume_doc'].params).toBe(1);
    expect(META_TEMPLATES['wa.resume_doc'].document).toBe(true);
  });

  it('maps OTP → login_otp for BOTH purposes (one approved auth template)', () => {
    expect(META_OTP_TEMPLATE.name).toBe('login_otp');
  });

  it('THROWS on an unmapped key rather than sending the key as a name', () => {
    // processor:55 does `whatsappTemplate ?? type`, so an unmapped whatsapp-tier
    // entry would hand us a NotificationType enum name.
    expect(() => resolveMetaTemplate('APPLICATION_SHORTLISTED')).toThrow(/no approved meta template/i);
  });

  it('startup validation passes for the CURRENT matrix', () => {
    expect(() => assertTemplateMappingComplete()).not.toThrow();
  });
});

// ── Construction ─────────────────────────────────────────────────────────────

describe('construction — boot-time throws are intended', () => {
  it.each([['WHATSAPP_ACCESS_TOKEN'], ['WHATSAPP_PHONE_NUMBER_ID']])(
    'throws when %s is missing',
    (key) => {
      expect(() => new MetaWhatsappChannel(makeConfig({ [key]: undefined }))).toThrow(
        /not configured/i,
      );
    },
  );

  it('constructs cleanly with full config', () => {
    expect(() => new MetaWhatsappChannel(makeConfig())).not.toThrow();
  });
});

// ── THE CRITICAL PROPERTY: sends never throw ─────────────────────────────────

describe('sends RESOLVE on every failure path — never reject', () => {
  const channel = () => new MetaWhatsappChannel(makeConfig());

  it('network rejection → ok:false, no throw', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(channel().sendOtp(PHONE, '123456', 'LOGIN')).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'ENETWORK' }),
    );
  });

  it('timeout → ok:false ETIMEDOUT, no throw', async () => {
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    stubFetch(() => Promise.reject(err));
    await expect(channel().sendOtp(PHONE, '123456', 'LOGIN')).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'ETIMEDOUT' }),
    );
  });

  it('5xx whose body is HTML → res.json() rejects, and we STILL resolve', async () => {
    // The classic miss: Meta's edge returns HTML on some 5xx, so `await
    // res.json()` rejects AFTER we already know the request failed. Unguarded,
    // that becomes a 500 on login.
    stubFetch(() => Promise.resolve(res(502, null, { jsonThrows: true })));
    await expect(channel().sendOtp(PHONE, '123456', 'LOGIN')).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PROVIDER_ERROR' }),
    );
  });

  it('200 whose body is unparseable → resolves ok:true without a message id', async () => {
    stubFetch(() => Promise.resolve(res(200, null, { jsonThrows: true })));
    const result = await channel().sendOtp(PHONE, '123456', 'LOGIN');
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBeUndefined();
  });

  it('401 → EAUTH, no throw', async () => {
    stubFetch(() => Promise.resolve(res(401, { error: { message: 'bad token' } })));
    await expect(channel().sendOtp(PHONE, '1', 'LOGIN')).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'EAUTH' }),
    );
  });

  it('MEDIA UPLOAD failure → ok:false, no throw (a SECOND network call)', async () => {
    // The upload is a separate request with its own failure modes; a try scoped
    // only around the send would let this escape.
    stubFetch((url) =>
      url.includes('/media')
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(res(200, OK_BODY)),
    );
    await expect(
      channel().sendTemplate(PHONE, 'wa.resume_doc', {
        bodyParams: ['Suresh Kumar'],
        document: { filename: 'r.pdf', bytes: Buffer.from('%PDF'), mimeType: 'application/pdf' },
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('media upload returning HTML → resolves, does not throw', async () => {
    stubFetch((url) =>
      url.includes('/media')
        ? Promise.resolve(res(500, null, { jsonThrows: true }))
        : Promise.resolve(res(200, OK_BODY)),
    );
    await expect(
      channel().sendTemplate(PHONE, 'wa.resume_doc', {
        bodyParams: ['Suresh Kumar'],
        document: { filename: 'r.pdf', bytes: Buffer.from('%PDF'), mimeType: 'application/pdf' },
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('an UNMAPPED template key resolves ok:false — it does not throw into the caller', async () => {
    stubFetch(() => Promise.resolve(res(200, OK_BODY)));
    await expect(
      channel().sendTemplate(PHONE, 'wa.nonexistent', { bodyParams: [] }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'TEMPLATE_NOT_MAPPED' }));
  });
});

// ── Success + semantics ──────────────────────────────────────────────────────

describe('successful sends', () => {
  const channel = () => new MetaWhatsappChannel(makeConfig());

  it('reads providerMessageId from messages[0].id — W2 joins on this', async () => {
    stubFetch(() => Promise.resolve(res(200, OK_BODY)));
    const result = await channel().sendOtp(PHONE, '123456', 'LOGIN');
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.TEST123' });
  });

  it('posts to the pinned Graph version and phone number id', async () => {
    let seen = '';
    stubFetch((url) => {
      seen = url;
      return Promise.resolve(res(200, OK_BODY));
    });
    await channel().sendOtp(PHONE, '123456', 'LOGIN');
    expect(seen).toBe('https://graph.facebook.com/v21.0/123456/messages');
  });

  it('sends job_selected with its three params IN ORDER', async () => {
    let body: Record<string, unknown> = {};
    stubFetch((_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Promise.resolve(res(200, OK_BODY));
    });

    await channel().sendTemplate(PHONE, 'wa.selected', {
      bodyParams: ['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC'],
    });

    const template = body['template'] as { name: string; components: { parameters: { text: string }[] }[] };
    expect(template.name).toBe('job_selected');
    // Positional: Meta's parameters are ordered, and a swapped pair reads
    // plausibly while being false.
    expect(template.components[0]!.parameters.map((p) => p.text)).toEqual([
      'Suresh Kumar',
      'Senior Electrician',
      'Gulf Wiring LLC',
    ]);
  });

  it('refuses a param-count mismatch BEFORE calling Meta', async () => {
    stubFetch(() => Promise.resolve(res(200, OK_BODY)));
    const result = await channel().sendTemplate(PHONE, 'wa.selected', { bodyParams: ['only one'] });
    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'TEMPLATE_PARAM_MISMATCH' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a document template with no document', async () => {
    stubFetch(() => Promise.resolve(res(200, OK_BODY)));
    const result = await channel().sendTemplate(PHONE, 'wa.resume_doc', { bodyParams: ['Name'] });
    expect(result).toEqual(expect.objectContaining({ ok: false, errorCode: 'DOCUMENT_MISSING' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploads the document then references its media id in the header', async () => {
    let messageBody: Record<string, unknown> = {};
    stubFetch((url, init) => {
      if (url.includes('/media')) return Promise.resolve(res(200, { id: 'media-999' }));
      messageBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Promise.resolve(res(200, OK_BODY));
    });

    await channel().sendTemplate(PHONE, 'wa.resume_doc', {
      bodyParams: ['Suresh Kumar'],
      document: {
        filename: 'Suresh-Kumar-Resume.pdf',
        bytes: Buffer.from('%PDF-1.4'),
        mimeType: 'application/pdf',
      },
    });

    const template = messageBody['template'] as { components: Record<string, unknown>[] };
    const header = template.components[0] as {
      type: string;
      parameters: { document: { id: string; filename: string } }[];
    };
    expect(header.type).toBe('header');
    expect(header.parameters[0]!.document.id).toBe('media-999');
    expect(header.parameters[0]!.document.filename).toBe('Suresh-Kumar-Resume.pdf');
  });

  it("maps Meta's unreachable-number code to notOnWhatsapp", async () => {
    // OtpService branches on this to return { sent:false, notOnWhatsapp:true }.
    stubFetch(() => Promise.resolve(res(400, { error: { code: 131026 } })));
    const result = await channel().sendOtp(PHONE, '123456', 'LOGIN');
    expect(result.notOnWhatsapp).toBe(true);
    expect(result.ok).toBe(false);
  });
});

// ── Redaction ────────────────────────────────────────────────────────────────

describe('no PII in logs', () => {
  it('never logs the phone number, the OTP code, or the token', async () => {
    const lines: string[] = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((m: unknown) => void lines.push(String(m)));

    stubFetch(() => Promise.resolve(res(200, OK_BODY)));
    await new MetaWhatsappChannel(makeConfig()).sendOtp(PHONE, '654321', 'LOGIN');

    const all = lines.join(' ');
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain('9876543210');
    expect(all).not.toContain('654321');
    expect(all).not.toContain('tok-secret');
  });
});

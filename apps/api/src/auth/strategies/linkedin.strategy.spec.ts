import { ConfigService } from '@nestjs/config';
import { LinkedinAuthError, LinkedinStrategy, isLinkedinConfigured } from './linkedin.strategy';

/**
 * The LinkedIn-specific hazards, tested at the seam where they actually bite.
 *
 * The account-resolution rules are shared with Google and covered in
 * auth.service.spec.ts. What is unique to LinkedIn is the SHAPE OF ITS RESPONSE
 * — an optional email, an optional verification flag — and every one of those
 * cases is a way for a sign-in to end badly if it is read optimistically.
 */

const CONFIG: Record<string, string> = {
  NODE_ENV: 'test',
  LINKEDIN_OAUTH_CLIENT_ID: 'client-id',
  LINKEDIN_OAUTH_CLIENT_SECRET: 'client-secret',
  LINKEDIN_OAUTH_CALLBACK_URL: 'https://api.example.com/api/v1/auth/linkedin/callback',
};

function configService(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values = { ...CONFIG, ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** The happy-path userinfo body; each test spoils exactly one field. */
const VALID_PROFILE = {
  sub: 'linkedin-subject-1',
  email: 'candidate@example.com',
  email_verified: true,
  name: 'Suresh Kumar',
  given_name: 'Suresh',
  family_name: 'Kumar',
};

describe('isLinkedinConfigured', () => {
  it('is true only when ALL THREE settings are present', () => {
    expect(isLinkedinConfigured(configService())).toBe(true);

    // A half-configured provider is treated as OFF, not as an error at boot:
    // the whole reason the module gates on this is that a missing key would
    // otherwise stop the API from starting.
    expect(isLinkedinConfigured(configService({ LINKEDIN_OAUTH_CLIENT_ID: undefined }))).toBe(false);
    expect(isLinkedinConfigured(configService({ LINKEDIN_OAUTH_CLIENT_SECRET: undefined }))).toBe(
      false,
    );
    expect(isLinkedinConfigured(configService({ LINKEDIN_OAUTH_CALLBACK_URL: undefined }))).toBe(
      false,
    );
  });
});

describe('LinkedinStrategy.validate', () => {
  let strategy: LinkedinStrategy;

  beforeEach(() => {
    strategy = new LinkedinStrategy(configService());
  });

  /** validate() is callback-style; this turns it into something assertable. */
  function validate(profile: unknown) {
    return new Promise<{ err: unknown; user: unknown }>((resolve) => {
      strategy.validate('access-token', 'refresh-token', profile as never, (err, user) =>
        resolve({ err, user }),
      );
    });
  }

  it('maps a complete profile to the sub, email and display name', async () => {
    const { err, user } = await validate(VALID_PROFILE);

    expect(err).toBeNull();
    expect(user).toEqual({
      linkedinId: 'linkedin-subject-1',
      email: 'candidate@example.com',
      displayName: 'Suresh Kumar',
    });
  });

  it('falls back to given+family name when `name` is absent', async () => {
    const { user } = await validate({ ...VALID_PROFILE, name: undefined });
    expect(user).toMatchObject({ displayName: 'Suresh Kumar' });
  });

  it('REFUSES a profile with no email — LinkedIn documents the field as optional', async () => {
    /*
      The case Google never produces and therefore never had to handle. `email`
      is optional in LinkedIn's userinfo response, and `users.email` is NOT NULL
      and unique here. The alternative to refusing is minting a placeholder
      address, which creates an unrecoverable account that silently drops every
      notification sent to it.
    */
    const { err, user } = await validate({ ...VALID_PROFILE, email: undefined });

    expect(user).toBeUndefined();
    expect(err).toBeInstanceOf(LinkedinAuthError);
    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_NO_EMAIL');
  });

  it('REFUSES an unverified email — account linking matches BY EMAIL', async () => {
    /*
      This is the account-takeover case, not a nicety. The service adopts an
      existing candidate whose address matches. Accepting an address LinkedIn has
      not confirmed would mean: claim a victim's address on LinkedIn, press the
      button here, inherit their profile and documents.
    */
    const { err } = await validate({ ...VALID_PROFILE, email_verified: false });

    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_EMAIL_UNVERIFIED');
  });

  it('treats a MISSING email_verified as unverified, not as verified', async () => {
    // The flag is optional too. Absence must read as "not confirmed" — the safe
    // interpretation — rather than being skipped over as if it said true.
    const { err } = await validate({ ...VALID_PROFILE, email_verified: undefined });

    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_EMAIL_UNVERIFIED');
  });

  it('refuses a profile with no subject', async () => {
    const { err } = await validate({ ...VALID_PROFILE, sub: undefined });
    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_PROFILE_FAILED');
  });
});

describe('LinkedinStrategy.userProfile', () => {
  let strategy: LinkedinStrategy;
  const realFetch = global.fetch;

  beforeEach(() => {
    strategy = new LinkedinStrategy(configService());
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  function userProfile(token = 'access-token') {
    return new Promise<{ err: unknown; profile: unknown }>((resolve) => {
      void strategy.userProfile(token, (err, profile) => resolve({ err, profile }));
    });
  }

  it('calls the OIDC userinfo endpoint with a bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID_PROFILE),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { err, profile } = await userProfile();

    expect(err).toBeNull();
    expect(profile).toEqual(VALID_PROFILE);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linkedin.com/v2/userinfo',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
      }),
    );
  });

  it('reports a provider failure as a coded error, never as a throw', async () => {
    // A throw out of here becomes a 500 rendered as JSON into a browser that is
    // mid-redirect. A coded error becomes a message on the login page.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const { err, profile } = await userProfile();

    expect(profile).toBeUndefined();
    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_PROFILE_FAILED');
  });

  it('survives an unreachable LinkedIn rather than hanging the request', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    const { err } = await userProfile();

    expect((err as LinkedinAuthError).code).toBe('LINKEDIN_PROFILE_FAILED');
  });
});

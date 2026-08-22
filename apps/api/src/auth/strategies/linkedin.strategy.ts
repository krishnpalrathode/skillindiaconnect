import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-oauth2';
import { LinkedinUser } from '../auth.service';
import { CookieStateStore } from './oauth-state.store';

/**
 * Sign In with LinkedIn — OpenID Connect.
 *
 * ── Why this is built on passport-oauth2, not passport-linkedin-oauth2 ──────
 * LinkedIn retired the old Sign In with LinkedIn (the `r_liteprofile` and
 * `r_emailaddress` scopes, and the /v2/me + /v2/emailAddress pair) and replaced
 * it with an OpenID Connect product. `passport-linkedin-oauth2` — the package
 * every tutorial reaches for — still asks for the retired scopes, so it fails at
 * the consent screen on a newly provisioned app.
 *
 * The OIDC flow is plain OAuth 2.0 plus one userinfo call, which passport-oauth2
 * already models. It is also already in this repo's lockfile as a dependency of
 * passport-google-oauth20, so adopting it adds a declaration rather than a new
 * supply-chain surface, and leaves us owning the LinkedIn-specific parts
 * outright instead of inheriting an unmaintained package's idea of them.
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 * Hardcoded from the discovery document rather than fetched from it. They have
 * been stable for years, and a network round trip to
 * /.well-known/openid-configuration on every boot buys nothing but a new way for
 * startup to fail.
 *
 * ── The ID token is deliberately not parsed ─────────────────────────────────
 * LinkedIn returns a signed JWT alongside the access token and the claims we
 * need are in it, so it looks like the userinfo call could be skipped. It could
 * not — not safely. Trusting those claims requires verifying RS256 against
 * LinkedIn's JWKS with key rotation and issuer/audience/expiry checks, and a JWT
 * read WITHOUT that verification is attacker-controlled input. The userinfo call
 * gets the same claims over an authenticated TLS channel with no crypto for us
 * to get wrong. One extra round trip, on a path where the user already waited
 * for a consent screen.
 */

const AUTHORIZATION_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

/**
 * `openid` selects OIDC, `profile` yields the name, `email` yields the address.
 * All three require the "Sign In with LinkedIn using OpenID Connect" product to
 * be provisioned on the app — without it LinkedIn rejects the scope outright.
 */
const SCOPES = ['openid', 'profile', 'email'];

/**
 * The user is sitting on a redirect with a blank screen, so failing fast beats
 * hanging. Mirrors the reasoning behind WHATSAPP_TIMEOUT_MS on the OTP path.
 */
const USERINFO_TIMEOUT_MS = 8_000;

/** The subset of the OIDC userinfo response we actually consume. */
interface LinkedinUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
}

/**
 * A failure the CALLER can turn into a specific message, rather than a 500.
 *
 * The controller redirects the browser back to the login page carrying this
 * `code`. Without it every failure here — LinkedIn down, consent withdrawn, no
 * email on the account — would surface as an identical opaque error on a page
 * the user cannot act on.
 */
export class LinkedinAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'LinkedinAuthError';
  }
}

/** All three settings present, or the provider is not configured at all. */
export function isLinkedinConfigured(config: ConfigService): boolean {
  return Boolean(
    config.get<string>('LINKEDIN_OAUTH_CLIENT_ID') &&
      config.get<string>('LINKEDIN_OAUTH_CLIENT_SECRET') &&
      config.get<string>('LINKEDIN_OAUTH_CALLBACK_URL'),
  );
}

@Injectable()
export class LinkedinStrategy extends PassportStrategy(Strategy, 'linkedin') {
  private readonly logger = new Logger(LinkedinStrategy.name);

  constructor(configService: ConfigService) {
    const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';

    super({
      authorizationURL: AUTHORIZATION_URL,
      tokenURL: TOKEN_URL,
      clientID: configService.get<string>('LINKEDIN_OAUTH_CLIENT_ID')!,
      clientSecret: configService.get<string>('LINKEDIN_OAUTH_CLIENT_SECRET')!,
      callbackURL: configService.get<string>('LINKEDIN_OAUTH_CALLBACK_URL')!,
      scope: SCOPES,
      // A real store, not the silent NullStore default — see oauth-state.store.ts
      // for the login-CSRF this closes and why a session-backed store is not an
      // option here.
      store: new CookieStateStore(nodeEnv !== 'development'),
    });
  }

  /**
   * Overrides passport-oauth2's no-op profile loader with the OIDC userinfo call.
   *
   * Every failure is surfaced as a LinkedinAuthError with a code, never as a
   * bare throw: this runs inside Passport, where an unrecognised error becomes a
   * 500 rendered as JSON into a browser that was mid-redirect.
   */
  async userProfile(
    accessToken: string,
    done: (err?: Error | null, profile?: LinkedinUserInfo) => void,
  ): Promise<void> {
    try {
      const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Status only. The body can echo back token material, and this logger
        // feeds Sentry — no PII, no credentials (see CLAUDE.md).
        this.logger.warn(`LinkedIn userinfo failed: HTTP ${response.status}`);
        done(
          new LinkedinAuthError('LINKEDIN_PROFILE_FAILED', 'Could not read LinkedIn profile'),
        );
        return;
      }

      done(null, (await response.json()) as LinkedinUserInfo);
    } catch (err) {
      // Timeout or transport failure. `err` is logged by name only for the same
      // reason as above.
      this.logger.warn(
        `LinkedIn userinfo unreachable: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      done(new LinkedinAuthError('LINKEDIN_PROFILE_FAILED', 'Could not reach LinkedIn'));
    }
  }

  /**
   * Arity 4 — passport-oauth2 selects the verify overload by parameter count,
   * and 4 means `(accessToken, refreshToken, profile, done)`. Matches the Google
   * strategy's shape.
   */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: LinkedinUserInfo,
    done: (err: Error | null, user?: LinkedinUser) => void,
  ): void {
    if (!profile?.sub) {
      done(new LinkedinAuthError('LINKEDIN_PROFILE_FAILED', 'LinkedIn returned no subject'));
      return;
    }

    /*
      THE case that separates LinkedIn from Google.

      LinkedIn documents `email` and `email_verified` as OPTIONAL — a member may
      have no email released to the app at all. Google always returns one, so the
      Google path never had to think about it. Our `users.email` is NOT NULL and
      unique, and it is the identity the whole product is keyed on: password
      reset, every notification, "email to myself" on the resume.

      Inventing a placeholder to get past the constraint would create an account
      that can never be recovered and silently swallow its notifications. So this
      stops here with a code the user can act on — sign up with email instead.
    */
    if (!profile.email) {
      done(
        new LinkedinAuthError(
          'LINKEDIN_NO_EMAIL',
          'LinkedIn did not share an email address for this account',
        ),
      );
      return;
    }

    /*
      An UNVERIFIED address is refused rather than trusted.

      Account linking below matches an incoming LinkedIn identity to an existing
      account BY EMAIL. If LinkedIn would hand us an address it has not confirmed
      belongs to the member, that match becomes an account-takeover primitive:
      claim someone's address on LinkedIn, sign in here, and inherit their
      candidate profile. `email_verified` is optional in the response, so absent
      is treated as unverified — the safe reading, not the convenient one.
    */
    if (profile.email_verified !== true) {
      done(
        new LinkedinAuthError(
          'LINKEDIN_EMAIL_UNVERIFIED',
          'LinkedIn has not verified the email on this account',
        ),
      );
      return;
    }

    const displayName =
      profile.name ?? [profile.given_name, profile.family_name].filter(Boolean).join(' ');

    done(null, {
      linkedinId: profile.sub,
      email: profile.email,
      displayName,
    });
  }
}

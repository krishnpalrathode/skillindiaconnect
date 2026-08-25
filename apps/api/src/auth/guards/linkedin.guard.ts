import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { LinkedinAuthError } from '../strategies/linkedin.strategy';

/** What the controller receives when the handshake did not produce a user. */
export interface OAuthFailure {
  oauthError: string;
}

export function isOAuthFailure(value: unknown): value is OAuthFailure {
  return typeof value === 'object' && value !== null && 'oauthError' in value;
}

/**
 * Like GoogleGuard, except it never throws.
 *
 * The default AuthGuard turns any failure into a 401/500, which Nest renders as
 * a JSON error body. That is the correct behaviour for an XHR endpoint and the
 * wrong behaviour here: this route is the tail of a browser redirect chain, so
 * the person sees a wall of JSON on an API domain with no way back to the app.
 *
 * Instead every failure is converted into a sentinel on `req.user`, and the
 * controller redirects to the login page with a code the UI can translate. The
 * contract already documents that shape for the Google callback
 * (`?error=GOOGLE_NOT_ALLOWED`); this is the first implementation of it.
 *
 * Note this guard cannot distinguish "user declined consent" from other
 * provider-side refusals — LinkedIn reports both as a failed handshake — so both
 * land on LINKEDIN_FAILED, whose copy is written to fit either.
 */
@Injectable()
export class LinkedinGuard extends AuthGuard('linkedin') {
  /**
   * Lets the request THROUGH when the provider is not configured.
   *
   * LINKEDIN_OAUTH_* are optional, so on a deployment without them the strategy
   * is never registered with Passport and `authenticate('linkedin')` throws
   * `Unknown authentication strategy` — a 500 for a state that is deliberate,
   * not broken. Catching it here hands control to the route, which redirects to
   * the login page with LINKEDIN_UNAVAILABLE.
   *
   * Matched on the strategy NAME, not just the error text, so this cannot
   * swallow an unrelated failure and quietly present a configured provider as
   * merely unavailable.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      if (err instanceof Error && /unknown authentication strategy.*linkedin/i.test(err.message)) {
        const req = context.switchToHttp().getRequest<Request>();
        (req as Request & { user: OAuthFailure }).user = { oauthError: 'LINKEDIN_UNAVAILABLE' };
        return true;
      }
      throw err;
    }
  }

  handleRequest<TUser = unknown>(err: unknown, user: unknown): TUser {
    if (user) return user as TUser;

    if (err instanceof LinkedinAuthError) {
      return { oauthError: err.code } as TUser;
    }

    /*
      Everything else collapses to one code on purpose.

      `err` here can be a state mismatch (a CSRF attempt, or a stale tab
      completed after the 10-minute nonce expired), a declined consent screen, or
      a token exchange LinkedIn rejected. Reporting which one to the browser
      would tell an attacker probing the callback exactly how far they got, and
      tells a legitimate user nothing they can act on differently: in every case
      the next step is to try again or use email.
    */
    return { oauthError: 'LINKEDIN_FAILED' } as TUser;
  }
}

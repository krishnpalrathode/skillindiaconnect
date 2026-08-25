import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * CSRF protection for the OAuth redirect, without a server session.
 *
 * ── Why a custom store at all ───────────────────────────────────────────────
 * passport-oauth2 ships a state store, but it keeps the nonce in `req.session`.
 * This API registers Passport with `session: false` and runs no session
 * middleware, so that store throws the moment it is enabled. The alternative on
 * offer is `NullStore` — the silent default — which sends NO state parameter
 * and verifies nothing.
 *
 * ── What the attack is ──────────────────────────────────────────────────────
 * Without state, an attacker completes a LinkedIn sign-in far enough to obtain
 * a `code` for THEIR OWN LinkedIn account, then gets a victim to load our
 * callback URL carrying it. The victim's browser is silently signed in as the
 * attacker. Anything the victim then uploads — passport scans, phone number,
 * work history — lands in an account the attacker controls. That is login CSRF,
 * and for a product whose users upload identity documents it is not theoretical.
 *
 * ── How this store closes it ────────────────────────────────────────────────
 * The nonce is minted at /auth/linkedin and parked in an httpOnly cookie, then
 * required to match the `state` LinkedIn echoes back at the callback. An
 * attacker can supply a `code`, but cannot set a cookie on our API's domain, so
 * the two never agree.
 *
 * SameSite=Lax is exactly right and Strict is NOT: the callback arrives as a
 * cross-site top-level GET navigation from linkedin.com, which Lax permits and
 * Strict would drop — silently breaking every sign-in.
 *
 * The cookie is single-use. It is cleared on the way through whether
 * verification passed or failed, so a replayed callback URL cannot be retried.
 */

/** Long enough that guessing is hopeless; url-safe so it survives a query string. */
const STATE_BYTES = 32;

/** The round trip is a human clicking one consent button, not a work session. */
const STATE_TTL_MS = 10 * 60 * 1000;

export const OAUTH_STATE_COOKIE = 'sic_oauth_state';

/** Scoped to the auth routes, matching the refresh cookie — it is useless elsewhere. */
const COOKIE_PATH = '/api/v1/auth';

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (err: Error | null, ok: boolean, state?: string) => void;

/**
 * Constant-time comparison that does not leak the answer through its own
 * failure mode. `timingSafeEqual` throws on length mismatch, so length is
 * checked first — and a wrong length is already a mismatch.
 */
function sameNonce(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class CookieStateStore {
  constructor(private readonly isProduction: boolean) {}

  /**
   * Arity 3 — passport-oauth2 dispatches on `store.length` (see its
   * lib/strategy.js), calling `store(req, meta, cb)` at this arity. Changing the
   * parameter count silently changes which overload it invokes, so the shape
   * here is load-bearing and not merely stylistic.
   */
  store(req: Request, _meta: unknown, callback: StoreCallback): void {
    const nonce = randomBytes(STATE_BYTES).toString('base64url');
    const res = req.res as Response | undefined;

    if (!res) {
      // Cannot park the nonce, so cannot verify it later. Refusing to start is
      // the honest outcome — proceeding would send an unverifiable state and
      // present as working right up until it protected nothing.
      callback(new Error('OAuth state store requires a response object'));
      return;
    }

    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: STATE_TTL_MS,
    });

    callback(null, nonce);
  }

  /**
   * Arity 4 — again dispatched on `verify.length`, which selects
   * `verify(req, state, meta, cb)`.
   *
   * `ok` must be a BOOLEAN. passport-oauth2 reads a string return as a PKCE
   * code_verifier and would put it in the token request.
   */
  verify(req: Request, state: string | undefined, _meta: unknown, callback: VerifyCallback): void {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const expected = cookies[OAUTH_STATE_COOKIE];

    // Cleared on BOTH paths, before the comparison decides anything: a failed
    // attempt must not leave a live nonce behind for a second guess.
    req.res?.clearCookie(OAUTH_STATE_COOKIE, { path: COOKIE_PATH });

    if (!expected || !state || !sameNonce(expected, state)) {
      callback(null, false, 'invalid_state');
      return;
    }

    callback(null, true);
  }
}

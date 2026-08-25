import type { Request, Response } from 'express';
import { CookieStateStore, OAUTH_STATE_COOKIE } from './oauth-state.store';

/**
 * The login-CSRF defence, and the passport-oauth2 contract it plugs into.
 *
 * Both halves are worth pinning. The security behaviour is obvious enough; the
 * ARITY is not, and it is just as load-bearing — passport-oauth2 picks which
 * overload to call from `store.length` / `verify.length`, so a stray parameter
 * silently routes to a different signature and the store stops being called the
 * way it expects.
 */

function makeRes() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock };
}

function makeReq(cookies: Record<string, string> = {}) {
  const res = makeRes();
  return {
    req: { cookies, res } as unknown as Request,
    res,
  };
}

function store(s: CookieStateStore, req: Request) {
  return new Promise<{ err: Error | null; state?: string }>((resolve) => {
    s.store(req, {}, (err, state) => resolve({ err, state }));
  });
}

function verify(s: CookieStateStore, req: Request, state: string | undefined) {
  return new Promise<{ err: Error | null; ok: boolean }>((resolve) => {
    s.verify(req, state, {}, (err, ok) => resolve({ err, ok }));
  });
}

describe('CookieStateStore — passport-oauth2 contract', () => {
  it('exposes the arities passport-oauth2 dispatches on', () => {
    /*
      passport-oauth2 reads these lengths to choose an overload:
        store.length  === 3 -> store(req, meta, cb)
        verify.length === 4 -> verify(req, state, meta, cb)
      Change either count and it calls a DIFFERENT signature, quietly — the
      nonce would land in the wrong argument and verification would stop working
      while every test that calls the methods directly still passed.
    */
    const s = new CookieStateStore(false);
    expect(s.store.length).toBe(3);
    expect(s.verify.length).toBe(4);
  });

  it('returns a boolean for `ok`, never a string', async () => {
    // passport-oauth2 reads a STRING return as a PKCE code_verifier and puts it
    // into the token request. Only a boolean means "state verified".
    const s = new CookieStateStore(false);
    const { req } = makeReq();
    const { state } = await store(s, req);

    const result = await verify(s, makeReq({ [OAUTH_STATE_COOKIE]: state! }).req, state);
    expect(typeof result.ok).toBe('boolean');
  });
});

describe('CookieStateStore — issuing the nonce', () => {
  it('parks an httpOnly, SameSite=Lax cookie and returns the same value as state', async () => {
    const s = new CookieStateStore(false);
    const { req, res } = makeReq();

    const { err, state } = await store(s, req);

    expect(err).toBeNull();
    expect(state).toBeTruthy();

    const [name, value, options] = res.cookie.mock.calls[0]!;
    expect(name).toBe(OAUTH_STATE_COOKIE);
    // The cookie and the state parameter must be the SAME secret — comparing
    // two independently generated values would always fail.
    expect(value).toBe(state);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/v1/auth' });
  });

  it('uses SameSite=Lax, because Strict would break every sign-in', async () => {
    // The callback is a cross-site top-level GET from linkedin.com. Lax sends
    // the cookie on exactly that; Strict withholds it, so verification would
    // fail for legitimate users and the flow would never complete.
    const s = new CookieStateStore(true);
    const { req, res } = makeReq();
    await store(s, req);

    expect(res.cookie.mock.calls[0]![2]).toMatchObject({ sameSite: 'lax', secure: true });
  });

  it('issues a DIFFERENT nonce every time', async () => {
    const s = new CookieStateStore(false);
    const first = await store(s, makeReq().req);
    const second = await store(s, makeReq().req);

    expect(first.state).not.toBe(second.state);
    // Long enough that guessing is not a strategy.
    expect(first.state!.length).toBeGreaterThanOrEqual(40);
  });

  it('refuses to start the flow when it cannot park the nonce', async () => {
    // Sending an unverifiable state would look like it worked while protecting
    // nothing — the one outcome worse than failing.
    const s = new CookieStateStore(false);
    const { err, state } = await store(s, { cookies: {} } as unknown as Request);

    expect(err).toBeInstanceOf(Error);
    expect(state).toBeUndefined();
  });
});

describe('CookieStateStore — verifying the callback', () => {
  it('accepts a callback whose state matches the cookie', async () => {
    const s = new CookieStateStore(false);
    const nonce = 'a'.repeat(43);
    const { req } = makeReq({ [OAUTH_STATE_COOKIE]: nonce });

    const { err, ok } = await verify(s, req, nonce);

    expect(err).toBeNull();
    expect(ok).toBe(true);
  });

  it('REJECTS a forged callback — the login-CSRF case', async () => {
    /*
      The attack this exists for: an attacker holds a valid `code` for THEIR
      LinkedIn account and gets a victim to load our callback carrying it. The
      victim is signed in as the attacker, and everything they upload next —
      passport scans, phone number — lands in an account the attacker controls.

      The attacker cannot set a cookie on our API's domain, so the victim's
      browser carries no matching nonce.
    */
    const s = new CookieStateStore(false);
    const { req } = makeReq(); // victim has no state cookie

    const { ok } = await verify(s, req, 'attacker-supplied-state');

    expect(ok).toBe(false);
  });

  it('rejects a callback that carries no state at all', async () => {
    const s = new CookieStateStore(false);
    const { req } = makeReq({ [OAUTH_STATE_COOKIE]: 'expected' });

    expect((await verify(s, req, undefined)).ok).toBe(false);
  });

  it('rejects a mismatched state, and one that merely shares a prefix', async () => {
    const s = new CookieStateStore(false);

    expect((await verify(s, makeReq({ [OAUTH_STATE_COOKIE]: 'expected' }).req, 'other')).ok).toBe(
      false,
    );
    // Different lengths take the early return in the constant-time compare —
    // that path must reject, not throw.
    expect((await verify(s, makeReq({ [OAUTH_STATE_COOKIE]: 'expected' }).req, 'expect')).ok).toBe(
      false,
    );
  });

  it('clears the cookie on success AND on failure, so a nonce is single-use', async () => {
    // A nonce left behind after a failed attempt is a nonce that can be retried.
    const s = new CookieStateStore(false);

    const good = makeReq({ [OAUTH_STATE_COOKIE]: 'n' });
    await verify(s, good.req, 'n');
    expect(good.res.clearCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      expect.objectContaining({ path: '/api/v1/auth' }),
    );

    const bad = makeReq({ [OAUTH_STATE_COOKIE]: 'n' });
    await verify(s, bad.req, 'wrong');
    expect(bad.res.clearCookie).toHaveBeenCalled();
  });
});

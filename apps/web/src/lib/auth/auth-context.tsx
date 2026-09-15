'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { components } from '@skillindiaconnect/shared-types';
import { setAccessToken, setRefreshFn } from '@/lib/api/client';
import {
  postLogin,
  postLogout,
  postPhoneLoginVerify,
  postPhoneSignupVerify,
  postRefresh,
  postSignup,
} from './api';
import type { SignupBody } from './api';

type UserSummary = components['schemas']['UserSummary'];

// ─── Decode helper ────────────────────────────────────────────────────────────

// Reads user claims from the JWT payload without signature verification.
// Works for real JWTs (production) and the mock JWT-shaped tokens in dev/test.
//
// `email` is NOT required. A phone-signup account carries `email: null` in its
// token until onboarding verifies an address, and this function used to reject
// any payload with a falsy email — returning null, which every caller reads as
// "not signed in". The effect was not a cosmetic one: `doRefresh` runs on every
// page load and every 15-minute token renewal, so a candidate who signed up
// with their phone would have been silently signed out on their first reload,
// with a perfectly valid token in hand. Identity here is `sub` + `role`; the
// email is a display detail that may legitimately not exist yet.
/** The token-only claims the onboarding gate needs. */
interface CredentialClaims {
  hasPassword: boolean;
  hasGoogle: boolean;
}

/** UserSummary plus the token-only claims the onboarding gate needs. */
type SessionUser = UserSummary & CredentialClaims;

const NO_CREDENTIALS: CredentialClaims = { hasPassword: false, hasGoogle: false };

function decodeToken(token: string): SessionUser | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const raw = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(raw)) as Record<string, unknown>;
    if (!payload['sub'] || !payload['role']) return null;
    return {
      id: payload['sub'] as string,
      email: (payload['email'] as string | null | undefined) ?? null,
      role: payload['role'] as UserSummary['role'],
      // Both present on tokens issued after they were added; absent (→ false) on
      // any older token still in flight, which reads as "no credential yet" and
      // at worst shows onboarding once until the next refresh re-issues it.
      hasPassword: payload['hasPassword'] === true,
      hasGoogle: payload['hasGoogle'] === true,
    };
  } catch {
    return null;
  }
}

/**
 * Both claims from one token, together. They are held as ONE piece of state so
 * the gate can never read a fresh `hasPassword` beside a stale `hasGoogle`.
 */
function claimsOf(token: string): CredentialClaims {
  const decoded = decodeToken(token);
  return decoded
    ? { hasPassword: decoded.hasPassword, hasGoogle: decoded.hasGoogle }
    : NO_CREDENTIALS;
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface AuthContextValue {
  user: UserSummary | null;
  /**
   * Whether the signed-in account has a usable password (a token claim). A phone
   * signup starts `false` and flips `true` once they set one in onboarding — the
   * app's gate requires it, so a phone-only account can always sign back in.
   */
  hasPassword: boolean;
  /**
   * Whether the signed-in account is linked to Google (a token claim). Google is
   * a durable way back in, so it satisfies the gate's password requirement — the
   * same rule onboarding applies when it decides not to ask for a password.
   */
  hasGoogle: boolean;
  isLoading: boolean;
  /**
   * True from the moment a DELIBERATE sign-out starts until the next sign-in.
   *
   * Route guards must skip their "no user → /login" redirect while this is set.
   * Without it, clearing `user` makes every guard fire at once and the guard's
   * redirect races — and beats — the sign-out's own redirect, so a user who
   * signed out lands back on the login form instead of the landing page.
   */
  isLoggingOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithPhone: (phone: string, otp: string) => Promise<void>;
  signup: (body: SignupBody) => Promise<void>;
  signupWithPhone: (phone: string, otp: string, acceptedTerms: boolean) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Re-fetch the session token and refresh `user` from it. Used after onboarding
   * verifies an email so the token (and therefore `user.email`) reflects the
   * newly-verified address — which is what releases the app's email gate.
   */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
  // Derived from the access-token claims, tracked alongside `user` so the gate
  // can read them synchronously. Set at every point the token changes (below).
  const [claims, setClaims] = useState<CredentialClaims>(NO_CREDENTIALS);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // The in-flight refresh, SHARED. Concurrent callers must AWAIT the same
  // promise — the old boolean guard returned null to the second caller, which
  // meant "refresh failed": in dev StrictMode the double-mounted bootstrap's
  // second call resolved isLoading=false while user was still null, so every
  // full-page load of a guarded route bounced an AUTHENTICATED user through
  // /login (caught live by the S6 happy-path pass, C2's reload). The same race
  // hits any 401-triggered refresh that lands while another is in flight.
  const refreshPromise = useRef<Promise<string | null> | null>(null);
  // Incremented by login/signup/logout so a concurrent doRefresh doesn't overwrite
  // state that was set by an explicit auth action (e.g., signup during bootstrap).
  const authGeneration = useRef(0);

  // Called by the API client on 401 to silently renew the token.
  // Returns the new token or null (triggers logout in the form component).
  const doRefresh = useCallback((): Promise<string | null> => {
    if (refreshPromise.current) return refreshPromise.current;
    const myGeneration = authGeneration.current;
    refreshPromise.current = (async () => {
      try {
        const result = await postRefresh();
        setAccessToken(result.accessToken);
        setUser(decodeToken(result.accessToken));
        setClaims(claimsOf(result.accessToken));
        return result.accessToken;
      } catch {
        // Only clear auth state if no explicit login/signup/logout superseded us.
        if (authGeneration.current === myGeneration) {
          setAccessToken(null);
          setUser(null);
          setClaims(NO_CREDENTIALS);
        }
        return null;
      } finally {
        refreshPromise.current = null;
      }
    })();
    return refreshPromise.current;
  }, []);

  // On mount: wire the refresh function into the API client, then bootstrap auth.
  useEffect(() => {
    setRefreshFn(doRefresh);

    doRefresh().finally(() => setIsLoading(false));

    return () => setRefreshFn(null);
  }, [doRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    authGeneration.current++;
    setIsLoggingOut(false);
    const result = await postLogin({ email, password });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setClaims(claimsOf(result.accessToken));
  }, []);

  const loginWithPhone = useCallback(async (phone: string, otp: string) => {
    authGeneration.current++;
    setIsLoggingOut(false);
    const result = await postPhoneLoginVerify(phone, otp);
    setAccessToken(result.accessToken);
    setUser(result.user);
    setClaims(claimsOf(result.accessToken));
  }, []);

  const signup = useCallback(async (body: SignupBody) => {
    authGeneration.current++;
    setIsLoggingOut(false);
    const result = await postSignup(body);
    setAccessToken(result.accessToken);
    setUser(result.user);
    setClaims(claimsOf(result.accessToken));
  }, []);

  /**
   * Phone signup returns the same token pair as every other entry point, so the
   * session is established here identically — the ONLY difference is that
   * `result.user.email` is null until onboarding verifies an address.
   */
  const signupWithPhone = useCallback(
    async (phone: string, otp: string, acceptedTerms: boolean) => {
      authGeneration.current++;
      setIsLoggingOut(false);
      const result = await postPhoneSignupVerify(phone, otp, acceptedTerms);
      setAccessToken(result.accessToken);
      setUser(result.user);
      setClaims(claimsOf(result.accessToken));
    },
    [],
  );

  const logout = useCallback(async () => {
    authGeneration.current++;
    setIsLoggingOut(true);
    try {
      await postLogout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setClaims(NO_CREDENTIALS);
    }
  }, []);

  // Thin wrapper over the internal refresh so callers (e.g. the onboarding email
  // verify) can force a token re-issue after a server-side change to the user —
  // rotate() re-reads the row, so the new token carries the verified email.
  const refreshSession = useCallback(async () => {
    await doRefresh();
  }, [doRefresh]);

  return (
    <AuthContext.Provider
      value={{
        user,
        hasPassword: claims.hasPassword,
        hasGoogle: claims.hasGoogle,
        isLoading,
        isLoggingOut,
        login,
        loginWithPhone,
        signup,
        signupWithPhone,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

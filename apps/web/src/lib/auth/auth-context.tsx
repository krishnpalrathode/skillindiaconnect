'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { components } from '@skillindiaconnect/shared-types';
import { setAccessToken, setRefreshFn } from '@/lib/api/client';
import { postLogin, postLogout, postPhoneLoginVerify, postRefresh, postSignup } from './api';
import type { SignupBody } from './api';

type UserSummary = components['schemas']['UserSummary'];

// ─── Decode helper ────────────────────────────────────────────────────────────

// Reads user claims from the JWT payload without signature verification.
// Works for real JWTs (production) and the mock JWT-shaped tokens in dev/test.
function decodeToken(token: string): UserSummary | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const raw = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(raw)) as Record<string, unknown>;
    if (!payload['sub'] || !payload['email'] || !payload['role']) return null;
    return {
      id: payload['sub'] as string,
      email: payload['email'] as string,
      role: payload['role'] as UserSummary['role'],
    };
  } catch {
    return null;
  }
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface AuthContextValue {
  user: UserSummary | null;
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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
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
        return result.accessToken;
      } catch {
        // Only clear auth state if no explicit login/signup/logout superseded us.
        if (authGeneration.current === myGeneration) {
          setAccessToken(null);
          setUser(null);
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
  }, []);

  const loginWithPhone = useCallback(async (phone: string, otp: string) => {
    authGeneration.current++;
    setIsLoggingOut(false);
    const result = await postPhoneLoginVerify(phone, otp);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const signup = useCallback(async (body: SignupBody) => {
    authGeneration.current++;
    setIsLoggingOut(false);
    const result = await postSignup(body);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    authGeneration.current++;
    setIsLoggingOut(true);
    try {
      await postLogout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isLoggingOut, login, loginWithPhone, signup, logout }}
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

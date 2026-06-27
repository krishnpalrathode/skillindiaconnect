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
  const refreshing = useRef(false);
  // Incremented by login/signup/logout so a concurrent doRefresh doesn't overwrite
  // state that was set by an explicit auth action (e.g., signup during bootstrap).
  const authGeneration = useRef(0);

  // Called by the API client on 401 to silently renew the token.
  // Returns the new token or null (triggers logout in the form component).
  const doRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshing.current) return null;
    refreshing.current = true;
    const myGeneration = authGeneration.current;
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
      refreshing.current = false;
    }
  }, []);

  // On mount: wire the refresh function into the API client, then bootstrap auth.
  useEffect(() => {
    setRefreshFn(doRefresh);

    doRefresh().finally(() => setIsLoading(false));

    return () => setRefreshFn(null);
  }, [doRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    authGeneration.current++;
    const result = await postLogin({ email, password });
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const loginWithPhone = useCallback(async (phone: string, otp: string) => {
    authGeneration.current++;
    const result = await postPhoneLoginVerify(phone, otp);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const signup = useCallback(async (body: SignupBody) => {
    authGeneration.current++;
    const result = await postSignup(body);
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    authGeneration.current++;
    try {
      await postLogout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithPhone, signup, logout }}>
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

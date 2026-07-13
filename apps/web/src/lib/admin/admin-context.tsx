'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getAdminMe, type AdminMe, type PermissionKey } from '@/lib/api/admin';
import { ApiRequestError } from '@/lib/api/client';

export interface AdminContextValue {
  role: AdminMe['role'] | null;
  /** The keys the caller ACTUALLY holds, as answered by the server. */
  permissions: Set<PermissionKey>;
  /** The only way anything in the console should ask "can they?". */
  has: (key: PermissionKey) => boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

/**
 * The console's permission source.
 *
 * It FETCHES the effective permission set from the server and never derives it
 * from the role. That is not a style preference — Screen 27 changes grants at
 * runtime, so a role→capability map on the client would mean granting a
 * permission changes what a role CAN do without changing what it SEES. The two
 * drift, and the RBAC editor quietly becomes decorative.
 *
 * `has()` is UX ONLY. It decides what to render, never what is allowed: every
 * screen behind a hidden link still gets a 403 from the server if force-navigated
 * (see ForbiddenState). Client-side gating is a courtesy; the server is the
 * authority. Treating `has()` as security would be a bug.
 *
 * A 401 is left alone: the API client's interceptor already attempts one silent
 * refresh and AuthProvider owns the redirect. Duplicating that here would race it.
 */
export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMe = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMe(await getAdminMe());
    } catch (err) {
      // 401 → AuthProvider's refresh/redirect owns it; don't double-handle.
      if (err instanceof ApiRequestError && err.error.status === 401) {
        setMe(null);
      } else {
        setError(err as Error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const permissions = new Set<PermissionKey>(me?.permissions ?? []);

  const has = useCallback((key: PermissionKey) => (me?.permissions ?? []).includes(key), [me]);

  return (
    <AdminContext.Provider
      value={{
        role: me?.role ?? null,
        permissions,
        has,
        isLoading,
        error,
        refetch: () => void fetchMe(),
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside <AdminProvider>');
  return ctx;
}

'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { components } from '@skillindiaconnect/shared-types';
import { getCompany } from '@/lib/api/employer';
import { ApiRequestError } from '@/lib/api/client';

type Company = components['schemas']['Company'];

export interface EmployerContextValue {
  company: Company | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const EmployerContext = createContext<EmployerContextValue | null>(null);

export function EmployerProvider({ children }: { children: React.ReactNode }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCompany = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCompany();
      setCompany(data);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // 404 = employer has no company yet (mid-registration) — null company, no error
        if (err.error.status === 404) {
          setCompany(null);
        } else if (err.error.status === 401) {
          // Auth context handles 401 refresh/redirect — just surface null
          setCompany(null);
        } else {
          setError(err);
        }
      } else {
        setError(err as Error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  return (
    <EmployerContext.Provider value={{ company, isLoading, error, refetch: fetchCompany }}>
      {children}
    </EmployerContext.Provider>
  );
}

export function useEmployer(): EmployerContextValue {
  const ctx = useContext(EmployerContext);
  if (!ctx) throw new Error('useEmployer must be used inside <EmployerProvider>');
  return ctx;
}

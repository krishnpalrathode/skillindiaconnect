'use client';

import React, { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Spinner } from '@/components/ui/spinner';

interface EmployerRouteGuardProps {
  children: React.ReactNode;
}

export function EmployerRouteGuard({ children }: EmployerRouteGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(`/${locale}/login?next=/${locale}/dashboard`);
    } else if (user.role !== 'EMPLOYER') {
      // Candidate or admin → redirect to their home
      router.replace(`/${locale}/profile`);
    }
  }, [user, isLoading, router, locale]);

  if (isLoading || !user || user.role !== 'EMPLOYER') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <Spinner size={32} label="Loading…" />
      </div>
    );
  }

  return <>{children}</>;
}

'use client';

import React, { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { roleHome } from '@/lib/auth/role-home';
import { BrandLoader } from '@/components/ui/brand-loader';

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
      router.replace(`/${locale}/login?next=/${locale}/employer/dashboard`);
    } else if (user.role !== 'EMPLOYER') {
      // Candidate → their profile; admin → admin console. Sending an admin to
      // /profile loops (profile bounces non-candidates right back here).
      router.replace(
        user.role === 'CANDIDATE' ? `/${locale}/profile` : roleHome(user.role, locale),
      );
    }
  }, [user, isLoading, router, locale]);

  if (isLoading || !user || user.role !== 'EMPLOYER') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <BrandLoader size="lg" label="Loading…" />
      </div>
    );
  }

  return <>{children}</>;
}

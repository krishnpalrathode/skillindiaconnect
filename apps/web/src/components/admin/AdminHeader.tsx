'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin/admin-context';
import { Badge } from '@/components/ui/badge';

/**
 * Who am I, and what am I acting as.
 *
 * The role badge is not decoration. In a console where two people see different
 * navigation from the same URL, "why can't I see Settings?" is answered by
 * glancing at the header. It shows the role the SERVER reported (from
 * /admin/me/permissions), not one inferred from the token client-side.
 */
export function AdminHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const { showToast } = useToast();
  const { logout } = useAuth();
  const { role } = useAdmin();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  async function handleLogout() {
    await logout();
    showToast({ message: tCommon('logoutSuccess'), variant: 'success' });
    // Landing page, not /login — see AppLayout.handleLogout for the reasoning.
    router.replace(`/${locale}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={t('nav.toggle')}
        className="flex size-11 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      {/* Pushes the identity cluster to the end on desktop, where there's no menu button. */}
      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {role && (
          <Badge variant="primary" aria-label={t('roleBadgeLabel', { role })}>
            {role}
          </Badge>
        )}
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <LogOut className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('logout')}</span>
        </button>
      </div>
    </header>
  );
}

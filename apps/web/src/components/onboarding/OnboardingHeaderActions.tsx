'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useLogoutConfirm } from '@/lib/auth/logout-confirm';

/**
 * Sign-out for the onboarding shell.
 *
 * Onboarding has no sidebar and no account menu, so it was the one authenticated
 * area of the product with NO way out: a candidate part-way through setup either
 * finished or cleared their cookies. Living in the shared layout header means
 * every step gets it without each step remembering to add one.
 *
 * Rendered only when there is a session — the layout is briefly mounted while
 * auth resolves, and a Log out button for nobody is a dead control.
 */
export function OnboardingHeaderActions() {
  const t = useTranslations('nav');
  const { user } = useAuth();
  const { requestLogout } = useLogoutConfirm();

  if (!user) return null;

  return (
    <button
      type="button"
      // `/signup` rather than the default landing page: someone abandoning
      // half-finished onboarding is usually starting again.
      onClick={() => requestLogout({ redirectTo: '/signup' })}
      className="flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-error-bg hover:text-error-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
    >
      <LogOut className="size-4 shrink-0" aria-hidden="true" />
      {t('logout')}
    </button>
  );
}

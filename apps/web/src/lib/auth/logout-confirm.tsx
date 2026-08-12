'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { DialogShell } from '@/components/ui/dialog-shell';
import { useToast } from '@/components/ui/toast';
import { useAuth } from './auth-context';

interface LogoutConfirmOptions {
  /**
   * Where to land after signing out, as a locale-relative path (e.g. `/signup`).
   * Defaults to the public landing page.
   *
   * Onboarding passes `/signup`: someone abandoning half-finished setup is
   * usually starting over, and the landing page would make them hunt for the
   * way back in. It is an OPTION rather than a second copy of this flow so the
   * confirm → sign out → toast → redirect sequence still lives in one place.
   */
  redirectTo?: string;
}

interface LogoutConfirmContextValue {
  /** Opens the confirmation dialog. Signing out happens only if confirmed. */
  requestLogout: (options?: LogoutConfirmOptions) => void;
}

const LogoutConfirmContext = createContext<LogoutConfirmContextValue | null>(null);

export function useLogoutConfirm(): LogoutConfirmContextValue {
  const ctx = useContext(LogoutConfirmContext);
  if (!ctx) throw new Error('useLogoutConfirm must be used inside <LogoutConfirmProvider>');
  return ctx;
}

/**
 * Owns the ENTIRE sign-out flow in one place: confirm → sign out → toast →
 * land on the public landing page.
 *
 * It lives here rather than in each header because sign-out is triggered from
 * four different chromes (candidate sidebar, dashboard menu, employer header,
 * admin header). Those had four copies of the redirect, which is how one of
 * them could quietly drift to a different destination.
 */
export function LogoutConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth.logoutConfirm');
  const tCommon = useTranslations('common');
  const { logout } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Captured when the dialog opens so the destination cannot change (or be
  // lost) between the request and the confirm.
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  const requestLogout = useCallback((options?: LogoutConfirmOptions) => {
    setRedirectTo(options?.redirectTo ?? null);
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      showToast({ message: tCommon('logoutSuccess'), variant: 'success' });
      // Default is the landing page, not /login — someone who just left should
      // arrive somewhere public, not at a form asking them to sign back in.
      router.replace(`/${locale}${redirectTo ?? ''}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [logout, showToast, tCommon, router, locale, redirectTo]);

  const value = useMemo(() => ({ requestLogout }), [requestLogout]);

  return (
    <LogoutConfirmContext.Provider value={value}>
      {children}

      {open && (
        <DialogShell
          // alertdialog: this discards the session, so it should interrupt.
          role="alertdialog"
          titleId="logout-confirm-title"
          title={t('title')}
          busy={busy}
          confirmLabel={t('confirm')}
          confirmVariant="destructive"
          cancelLabel={t('cancel')}
          onConfirm={handleConfirm}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">{t('body')}</p>
        </DialogShell>
      )}
    </LogoutConfirmContext.Provider>
  );
}

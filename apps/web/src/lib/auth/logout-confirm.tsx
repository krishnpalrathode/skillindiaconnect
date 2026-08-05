'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { DialogShell } from '@/components/ui/dialog-shell';
import { useToast } from '@/components/ui/toast';
import { useAuth } from './auth-context';

interface LogoutConfirmContextValue {
  /** Opens the confirmation dialog. Signing out happens only if confirmed. */
  requestLogout: () => void;
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

  const requestLogout = useCallback(() => setOpen(true), []);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      showToast({ message: tCommon('logoutSuccess'), variant: 'success' });
      // Landing page, not /login — someone who just left should arrive
      // somewhere public, not at a form asking them to sign back in.
      router.replace(`/${locale}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [logout, showToast, tCommon, router, locale]);

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

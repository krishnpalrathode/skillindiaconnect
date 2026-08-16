'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminRouteGuard } from '@/components/admin/AdminRouteGuard';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AdminProvider, useAdmin } from '@/lib/admin/admin-context';
import { BrandLoader } from '@/components/ui/brand-loader';
import { Button } from '@/components/ui/button';

/**
 * The admin shell (the THIRD shell — same F0 design system as the candidate and
 * employer shells, no new tokens).
 *
 * Shares the employer shell's surface language — same #F5F8FC page ground, the
 * same translucent white sidebar, the same spacing rhythm — so moving between
 * consoles does not feel like moving between products.
 *
 * It previously used a DARK sidebar to signal "you are in the admin console",
 * because acting on other people's data while unsure which console you are in is
 * its own hazard. That signal has not been dropped, only moved off the chrome:
 * the shield mark and console name in the sidebar, and the role badge in the
 * header, still say plainly where you are.
 *
 * Desktop-first — this is an internal back-office tool, not a candidate-facing
 * screen. The sidebar collapses to a drawer below `lg` so it degrades gracefully,
 * but there is no constrained-device obligation here.
 */
function ShellInner({ children }: { children: React.ReactNode }) {
  const { isLoading, error, refetch } = useAdmin();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = useTranslations('admin');

  // The permission set gates the entire nav, so we cannot render a sidebar before
  // it arrives — a nav that pops items in after paint reads as broken.
  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <BrandLoader size="lg" label={t('loading')} />
      </div>
    );
  }

  // Without the permission set there is no honest nav to draw. Say so and offer a
  // retry rather than rendering an empty sidebar, which would look like "you have
  // no permissions" — a very different and much more alarming claim.
  if (error) {
    return (
      <div
        role="alert"
        className="flex min-h-svh flex-col items-center justify-center gap-4 bg-neutral-50 px-4 text-center"
      >
        <p className="text-sm font-medium text-error-fg">{t('permissionsLoadFailed')}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-[#F5F8FC] lg:flex">
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-neutral-900/40 backdrop-blur-sm lg:hidden"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.ariaLabel')}
            tabIndex={-1}
            onKeyDown={(e) => e.key === 'Escape' && setDrawerOpen(false)}
            className="fixed inset-y-0 start-0 z-50 w-72 bg-[#F5F8FC] shadow-2xl focus:outline-none lg:hidden"
          >
            <AdminSidebar onNavClick={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      <aside
        aria-label={t('nav.ariaLabel')}
        className="z-10 hidden border-e border-neutral-200/70 bg-white/95 backdrop-blur-sm lg:fixed lg:inset-y-0 lg:start-0 lg:flex lg:w-64 lg:shrink-0 lg:flex-col"
      >
        <AdminSidebar />
      </aside>

      <div className="flex min-h-svh flex-1 flex-col lg:ms-64">
        <AdminHeader onMenuClick={() => setDrawerOpen((o) => !o)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminRouteGuard>
      <AdminProvider>
        <ShellInner>{children}</ShellInner>
      </AdminProvider>
    </AdminRouteGuard>
  );
}

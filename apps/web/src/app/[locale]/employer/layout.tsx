'use client';

import React, { useRef, useState } from 'react';
import { EmployerRouteGuard } from '@/components/employer/EmployerRouteGuard';
import { EmployerProvider, useEmployer } from '@/lib/employer/employer-context';
import { EmployerSidebar } from '@/components/employer/EmployerSidebar';
import { EmployerHeader } from '@/components/employer/EmployerHeader';
import { CompanyStateBanner } from '@/components/employer/CompanyStateBanner';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  return (
    <>
      <div
        className="lg:hidden fixed inset-0 z-40 bg-black/30"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        id="employer-sidebar-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="lg:hidden fixed inset-y-0 start-0 z-50 w-72 bg-white shadow-xl focus:outline-none"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <EmployerSidebar onNavClick={onClose} />
      </div>
    </>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { company, isLoading, error, refetch } = useEmployer();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <Spinner size={32} label="Loading company…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-neutral-50 px-4 text-center">
        <p className="text-sm text-error-fg font-medium">
          Could not load company profile. Please check your connection and try again.
        </p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-neutral-50 lg:flex">
      {/* Mobile drawer */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Desktop sidebar */}
      <aside
        aria-label="Employer navigation"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:fixed lg:inset-y-0 lg:start-0 border-e border-neutral-200 bg-white z-10"
      >
        <EmployerSidebar />
      </aside>

      {/* Main column */}
      <div className="flex-1 lg:ms-64 flex flex-col min-h-svh">
        <EmployerHeader onMenuClick={() => setDrawerOpen((o) => !o)} />

        {/* Company-state banner */}
        {company && (
          <CompanyStateBanner status={company.status} rejectionReason={company.rejectionReason} />
        )}

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
  return (
    <EmployerRouteGuard>
      <EmployerProvider>
        <ShellInner>{children}</ShellInner>
      </EmployerProvider>
    </EmployerRouteGuard>
  );
}

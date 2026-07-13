import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../test-utils';
import {
  db,
  makeAccessToken,
  SUPER_ADMIN_USER_ID,
  ADMIN_USER_ID,
  MODERATOR_USER_ID,
} from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { AdminProvider } from '../../../lib/admin/admin-context';
import { AdminSidebar } from '../AdminSidebar';
import { AdminKpis } from '../dashboard/AdminKpis';
import { QueueCards } from '../dashboard/QueueCards';
import type { AdminDashboard } from '../../../lib/api/admin';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

/** Authenticate as a given admin fixture so useAdmin()'s fetch resolves for real. */
function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

/** Render inside a real AdminProvider and wait for /admin/me/permissions to land. */
async function renderWithAdmin(ui: React.ReactElement) {
  const result = render(<AdminProvider>{ui}</AdminProvider>);
  // The nav is empty until the permission set arrives; wait for Dashboard (the
  // always-present item) so assertions run against the resolved nav.
  await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  return result;
}

beforeEach(() => resetClient());
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

describe('AdminSidebar — permission-driven navigation', () => {
  it('SUPER_ADMIN sees every nav item', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    await renderWithAdmin(<AdminSidebar />);

    for (const label of [
      'Dashboard',
      'Employers',
      'Candidates',
      'Jobs',
      'Applications',
      'Audit log',
      'Roles & permissions',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('MODERATOR sees a STRICTLY SMALLER nav — no Settings, no Roles, no Applications', async () => {
    signInAs(MODERATOR_USER_ID);
    await renderWithAdmin(<AdminSidebar />);

    // Present: the keys a moderator holds in the seed.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Employers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Candidates' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();

    // Absent: keys a moderator lacks. These are the assertions that prove the nav
    // is gated by permission, not merely "is an admin".
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument(); // settings.view off
    expect(screen.queryByRole('link', { name: 'Roles & permissions' })).not.toBeInTheDocument(); // roles.view off
    expect(screen.queryByRole('link', { name: 'Applications' })).not.toBeInTheDocument(); // applications.manage off
  });

  it('ADMIN sees Roles & Settings (both), but not more than SUPER_ADMIN', async () => {
    signInAs(ADMIN_USER_ID);
    await renderWithAdmin(<AdminSidebar />);
    expect(screen.getByRole('link', { name: 'Roles & permissions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Applications' })).toBeInTheDocument();
  });

  it('the nav derives from the PERMISSION SET, not the role: revoke a key → its item disappears, role unchanged', async () => {
    signInAs(MODERATOR_USER_ID);
    const first = await renderWithAdmin(<AdminSidebar />);

    // A moderator holds jobs.view → Jobs is present.
    expect(screen.getByRole('link', { name: 'Jobs' })).toBeInTheDocument();

    // Revoke jobs.view in the LIVE matrix store — no role change whatsoever.
    const cell = db.rolePermissions.find(
      (c) => c.role === 'MODERATOR' && c.permission === 'jobs.view',
    );
    expect(cell).toBeDefined();
    cell!.enabled = false;

    // Unmount, then re-mount (a fresh permission fetch, as a page load would do).
    // Still a MODERATOR — but Jobs is now gone. Capability, not role name, drives
    // the nav, so a Screen-27 change actually takes effect.
    first.unmount();
    await renderWithAdmin(<AdminSidebar />);
    expect(screen.queryByRole('link', { name: 'Jobs' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Employers' })).toBeInTheDocument();

    // Restore for later tests (the store is module-level).
    cell!.enabled = true;
  });
});

describe('AdminKpis + QueueCards', () => {
  const dashboard: AdminDashboard = {
    counts: {
      candidates: 128,
      employers: { PENDING: 4, APPROVED: 37, REJECTED: 2 },
      jobs: { PENDING_REVIEW: 3, ACTIVE: 22, ARCHIVED: 11 },
      applications: { PENDING: 40, SHORTLISTED: 12, SELECTED: 5 },
    },
    revenueThisMonthSubunits: 353882,
    currency: 'INR',
    pendingEmployerReviews: 4,
    pendingJobReviews: 3,
  };

  it('formats revenue from subunits (never computes it)', () => {
    render(<AdminKpis data={dashboard} />);
    // 353882 paise → ₹3,538.82. The value is FORMATTED from the server figure.
    expect(screen.getByText('₹3,538.82')).toBeInTheDocument();
  });

  it('KPI cards carry value+meaning in one accessible label', () => {
    render(<AdminKpis data={dashboard} />);
    expect(screen.getByText('Candidates: 128')).toBeInTheDocument();
  });

  it('queue cards deep-link with the exact status filter, count in the accessible name', () => {
    render(<QueueCards data={dashboard} />);

    const employerQueue = screen.getByRole('link', { name: /Employers awaiting review: 4/ });
    expect(employerQueue).toHaveAttribute('href', '/en/admin/employers?status=PENDING');

    const jobQueue = screen.getByRole('link', { name: /Jobs awaiting review: 3/ });
    expect(jobQueue).toHaveAttribute('href', '/en/admin/jobs?status=PENDING_REVIEW');
  });

  it('an empty queue states "nothing waiting" rather than vanishing', () => {
    render(<QueueCards data={{ ...dashboard, pendingEmployerReviews: 0, pendingJobReviews: 0 }} />);
    const employerQueue = screen.getByRole('link', {
      name: /Employers awaiting review: Nothing waiting/,
    });
    expect(employerQueue).toBeInTheDocument();
  });
});

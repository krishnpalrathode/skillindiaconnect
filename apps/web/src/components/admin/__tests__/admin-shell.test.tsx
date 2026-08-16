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

  // Wait for a PERMISSION-GATED item, not for "Dashboard".
  //
  // AdminSidebar renders `ADMIN_NAV.filter(i => i.permission === null || has(i.permission))`,
  // and Dashboard is the `permission === null` entry — so it paints on the FIRST
  // render, before the permission fetch resolves. Gating on it therefore proved
  // only that the component had mounted, and let the assertions race the fetch:
  // under full-suite load the synchronous `getByRole('link', …)` for "Employers"
  // could run against a nav that still held Dashboard alone. That surfaced as an
  // intermittent failure here and in CI, passing in isolation every time.
  //
  // "Employers" is gated on `employers.view`, which every admin role exercised in
  // this file holds (SUPER_ADMIN, ADMIN, MODERATOR) — so its appearance is a
  // sound, role-agnostic signal that the permission set has actually landed.
  await waitFor(() => expect(screen.getByText('Employers')).toBeInTheDocument());
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

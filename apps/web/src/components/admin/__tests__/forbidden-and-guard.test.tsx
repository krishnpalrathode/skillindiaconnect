import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../test-utils';
import { db, makeAccessToken, MODERATOR_USER_ID, SUPER_ADMIN_USER_ID } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { AdminProvider } from '../../../lib/admin/admin-context';
import { AdminPlaceholder } from '../AdminPlaceholder';
import { PermissionGate } from '../PermissionGate';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/en/admin/settings',
  useSearchParams: () => new URLSearchParams(),
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

beforeEach(() => resetClient());
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

describe('Forced URL → ForbiddenState (the honest 403)', () => {
  it('a MODERATOR force-navigating to /admin/settings gets ForbiddenState from the SERVER 403, not a crash', async () => {
    // Settings is hidden from a moderator's nav — but hiding a link is not a lock.
    // They can type the URL. The placeholder probes the REAL /admin/settings, the
    // server refuses it (settings.view off), and we render the honest fallback.
    signInAs(MODERATOR_USER_ID);

    render(
      <AdminProvider>
        <AdminPlaceholder titleKey="settings" unit="S6a-F2" probePath="/admin/settings" />
      </AdminProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("You don't have permission for this")).toBeInTheDocument(),
    );
    // It names the missing key from the server's meta.requiredPermission…
    expect(screen.getByText('settings.view')).toBeInTheDocument();
    // …and it is announced (role=alert), not a silent blank page.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The placeholder body must NOT have rendered — the screen was refused.
    expect(screen.queryByText(/This screen is built in/)).not.toBeInTheDocument();
  });

  it('a SUPER_ADMIN reaching the same route sees the placeholder (server allowed it)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);

    render(
      <AdminProvider>
        <AdminPlaceholder titleKey="settings" unit="S6a-F2" probePath="/admin/settings" />
      </AdminProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/This screen is built in S6a-F2/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("You don't have permission for this")).not.toBeInTheDocument();
  });
});

describe('PermissionGate — in-screen affordance gating (UX only)', () => {
  it('shows the gated control to a holder (ADMIN has settings.manage)', async () => {
    signInAs('mock-user-admin-1');
    render(
      <AdminProvider>
        <PermissionGate permission="settings.manage">
          <button type="button">Save settings</button>
        </PermissionGate>
      </AdminProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument(),
    );
  });

  it('hides it from a non-holder (MODERATOR lacks settings.manage) — but this is UX, the server still 403s', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        {/* Sentinel: a key the MODERATOR DOES hold. When its control appears, the
            permission fetch has resolved — so the negative assertion below is
            real (button absent AFTER load), not a race against an unsettled fetch. */}
        <PermissionGate permission="jobs.view">
          <span>can-see-jobs</span>
        </PermissionGate>
        <PermissionGate permission="settings.manage">
          <button type="button">Save settings</button>
        </PermissionGate>
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('can-see-jobs')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });
});

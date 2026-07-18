import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../../../test-utils';
import { server } from '../../../../mocks/server';
import {
  db,
  makeAccessToken,
  SUPER_ADMIN_USER_ID,
  ADMIN_USER_ID,
  ALL_PERMISSION_KEYS,
  ADMIN_ROLES,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider } from '../../../../lib/admin/admin-context';
import { PermissionMatrix } from '../PermissionMatrix';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/roles',
  useSearchParams: () => new URLSearchParams(),
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

function cellInDb(role: string, permission: string) {
  const c = db.rolePermissions.find((x) => x.role === role && x.permission === permission);
  if (!c) throw new Error(`fixture: no cell ${role}/${permission}`);
  return c;
}

beforeEach(() => resetClient());
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

describe('PermissionMatrix — the grid', () => {
  it('renders roles × permissions, module-grouped, as a real table', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );

    const table = await screen.findByRole('table');
    // Columns: every admin role is a column header.
    for (const role of ADMIN_ROLES) {
      expect(within(table).getByRole('columnheader', { name: role })).toBeInTheDocument();
    }
    // Rows: every permission key appears (the machine key is printed under the label).
    for (const key of ALL_PERMISSION_KEYS) {
      expect(within(table).getByText(key)).toBeInTheDocument();
    }
    // Module group headers (getAll — a group name can also appear inside a
    // permission label, e.g. "view candidates").
    expect(within(table).getAllByText('Candidates').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getAllByText('Roles').length).toBeGreaterThanOrEqual(1);
  });

  it('the ENTIRE SUPER_ADMIN column is locked, with the reason in the accessible name', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );
    await screen.findByRole('table');

    // Every SUPER_ADMIN cell is the locked rendering (role="img", named with the
    // reason) — none is a togglable checkbox.
    const lockedSuperCells = screen.getAllByRole('img', { name: /^SUPER_ADMIN, .*locked/i });
    expect(lockedSuperCells).toHaveLength(ALL_PERMISSION_KEYS.length);
    expect(screen.queryByRole('checkbox', { name: /^SUPER_ADMIN,/i })).not.toBeInTheDocument();
  });

  it('a roles.view-only caller (ADMIN) gets the whole grid READ-ONLY + the note', async () => {
    signInAs(ADMIN_USER_ID); // holds roles.view, roles.manage is locked-off
    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );
    await screen.findByRole('table');

    expect(screen.getByText(/view this matrix but not change it/i)).toBeInTheDocument();
    // NO cell is editable — not one checkbox in the grid.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('flip: the confirm names BOTH SIDES in plain words; PATCH lands; the grid refetches', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const target = cellInDb('MODERATOR', 'logs.export');
    expect(target.enabled).toBe(false); // seeded off — the two-key boundary

    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );
    await screen.findByRole('table');

    await userEvent.click(
      screen.getByRole('checkbox', { name: /^MODERATOR, export the audit log: not allowed/i }),
    );

    // The plain-language confirm — role AND capability, not key soup.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/allow moderator to export the audit log\?/i);
    expect(dialog).toHaveTextContent(/takes effect immediately/i);
    expect(target.enabled).toBe(false); // nothing written until confirm

    await userEvent.click(within(dialog).getByRole('button', { name: /allow it/i }));

    // The mock db flipped and the REFETCHED grid shows it.
    await waitFor(() => expect(target.enabled).toBe(true));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /^MODERATOR, export the audit log: allowed/i }),
      ).toBeInTheDocument(),
    );

    // Restore the shared fixture.
    target.enabled = false;
  });

  it('423 on a forced locked flip → the calm guardrail notice, cell reverted', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // Force the server answer regardless of what the UI would normally allow.
    server.use(
      http.patch('/api/v1/admin/roles/matrix', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Locked',
            status: 423,
            detail: 'This permission is locked and cannot be changed.',
            code: 'PERMISSION_CELL_LOCKED',
          },
          { status: 423 },
        ),
      ),
    );

    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );
    await screen.findByRole('table');

    await userEvent.click(
      screen.getByRole('checkbox', { name: /^MODERATOR, export the audit log/i }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /allow it/i }),
    );

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(/can't be changed.*administrable/i);
    // The cell still shows the server's truth (unchanged).
    expect(cellInDb('MODERATOR', 'logs.export').enabled).toBe(false);
    expect(
      screen.getByRole('checkbox', { name: /^MODERATOR, export the audit log: not allowed/i }),
    ).toBeInTheDocument();
  });

  it('SELF_LOCKOUT_FORBIDDEN renders as the guardrail working, not a failure', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    server.use(
      http.patch('/api/v1/admin/roles/matrix', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unprocessable',
            status: 422,
            detail: 'You cannot revoke your own ability to manage roles.',
            code: 'SELF_LOCKOUT_FORBIDDEN',
          },
          { status: 422 },
        ),
      ),
    );

    render(
      <AdminProvider>
        <PermissionMatrix />
      </AdminProvider>,
    );
    await screen.findByRole('table');

    await userEvent.click(
      screen.getByRole('checkbox', { name: /^MODERATOR, export the audit log/i }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /allow it/i }),
    );

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(/guardrail working, not an error/i);
  });
});

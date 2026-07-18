import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../../test-utils';
import { db, makeAccessToken, SUPER_ADMIN_USER_ID, ADMIN_USER_ID } from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider } from '../../../../lib/admin/admin-context';
import { SettingsTabs } from '../SettingsTabs';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/settings',
  useSearchParams: () => new URLSearchParams(),
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

function settingByKey(key: string) {
  const s = db.settings.find((x) => x.key === key);
  if (!s) throw new Error(`fixture: setting ${key} missing`);
  return s;
}

beforeEach(() => resetClient());
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

describe('SettingsTabs — grouping + typed editors', () => {
  it('groups by key prefix into tabs; worker protection lands first', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /worker protection/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Candidates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument();

    // The landing tab shows the three core rules as SWITCHES (boolean → toggle).
    expect(screen.getByRole('switch', { name: /require accommodation/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /require health insurance/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /require transportation/i })).toBeInTheDocument();
  });

  it('renders a NUMBER editor for numeric settings and a CHIP editor for string[]', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Jobs' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    const archiveInput = screen.getByLabelText(/auto-archive after/i);
    expect(archiveInput).toHaveAttribute('type', 'number');
    expect(archiveInput).toHaveValue(90);

    await userEvent.click(screen.getByRole('tab', { name: 'Candidates' }));
    // The mandatory-documents list renders each item as a removable chip.
    const list = screen.getByRole('list', { name: /mandatory documents/i });
    expect(within(list).getByText('PASSPORT')).toBeInTheDocument();
    expect(within(list).getByText('EXPERIENCE_CERT')).toBeInTheDocument();
  });

  it('a non-core edit is dirty → save → persisted (per-row save scope)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const setting = settingByKey('jobs.auto_archive_days');
    const prev = setting.value;

    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Jobs' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'Jobs' }));

    const input = screen.getByLabelText(/auto-archive after/i);
    await userEvent.clear(input);
    await userEvent.type(input, '120');

    // Dirty state materialises the save rail; save persists exactly this key.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
    expect(settingByKey('jobs.auto_archive_days').value).toBe(120);

    setting.value = prev; // restore shared fixture
  });
});

describe('CoreRuleCell — the worker-protection friction', () => {
  it('a non-SUPER_ADMIN (ADMIN) sees core rules LOCKED with the reason in the accessible name', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );

    const toggle = await screen.findByRole('switch', {
      name: /require accommodation.*super admin only/i,
    });
    expect(toggle).toBeDisabled();
    // The visible lock reason too, not just AT-visible.
    expect(screen.getAllByText(/super admin only/i).length).toBeGreaterThan(0);
  });

  it('a forced core-rule 403 reverts the row with a clear message, never a crash', async () => {
    // The mock enforces the SUPER_ADMIN core-rule gate server-side; an ADMIN
    // bypassing the disabled UI (here: by wiring the save path directly) gets
    // CORE_RULE_FORBIDDEN. We simulate the stale-role case: render as ADMIN but
    // force the row enabled by flipping the fixture's core flag off, then back.
    signInAs(ADMIN_USER_ID);
    const setting = settingByKey('worker_protection.accommodation_required');

    // Make the row EDITABLE in the UI (as if the client state were stale)…
    setting.isCoreRule = false;
    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /require accommodation/i });
    // …but the SERVER decides with the real flag restored:
    setting.isCoreRule = true;

    await userEvent.click(toggle); // dirty
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The row reverts to the server value and states why.
    await waitFor(() =>
      expect(
        screen.getByText(/only a super admin can change worker-protection/i),
      ).toBeInTheDocument(),
    );
    expect(settingByKey('worker_protection.accommodation_required').value).toBe(true);
    expect(screen.getByRole('switch', { name: /require accommodation/i })).toBeChecked();
  });

  it('SUPER_ADMIN turning a core rule OFF gets the consequence dialog; confirming saves', async () => {
    signInAs(SUPER_ADMIN_USER_ID);

    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /require accommodation/i });

    await userEvent.click(toggle); // ON → OFF (dirty)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // THE dialog: names the consequence in plain words before anything persists.
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/publishable without guaranteed accommodation/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/weakens worker protection/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/takes effect immediately/i)).toBeInTheDocument();
    // Nothing saved yet.
    expect(settingByKey('worker_protection.accommodation_required').value).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: /turn it off/i }));
    await waitFor(() =>
      expect(settingByKey('worker_protection.accommodation_required').value).toBe(false),
    );

    // Restore the shared fixture (turning it back ON must NOT prompt).
    const toggleAgain = screen.getByRole('switch', { name: /require accommodation/i });
    await userEvent.click(toggleAgain);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // ON needs no friction
    await waitFor(() =>
      expect(settingByKey('worker_protection.accommodation_required').value).toBe(true),
    );
  });

  it('cancelling the consequence dialog saves nothing', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <SettingsTabs />
      </AdminProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /require health insurance/i });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /keep it on/i }));

    expect(settingByKey('worker_protection.health_insurance_required').value).toBe(true);
  });
});

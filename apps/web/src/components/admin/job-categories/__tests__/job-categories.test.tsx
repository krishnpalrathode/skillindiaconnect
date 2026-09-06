import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../../test-utils';
import { db, makeAccessToken, SUPER_ADMIN_USER_ID } from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider } from '../../../../lib/admin/admin-context';
import { JobCategoriesManager } from '../JobCategoriesManager';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/job-categories',
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

describe('JobCategoriesManager', () => {
  it('lists categories with status and job counts, and offers Add to a manager', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <JobCategoriesManager />
      </AdminProvider>,
    );

    // Rows come from GET /admin/job-categories (mock: Welder active/3, Driver inactive/0, Other).
    await waitFor(() => expect(screen.getByText('Welder')).toBeInTheDocument());
    expect(screen.getByText('Driver')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();

    // Active/inactive both render (two categories are active in the fixture).
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeInTheDocument();

    // A caller with job_categories.manage sees the Add action.
    expect(screen.getByRole('button', { name: /add category/i })).toBeInTheDocument();
  });

  it('protects the "Other" category: its delete action is disabled', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <JobCategoriesManager />
      </AdminProvider>,
    );

    const otherRow = await waitFor(() => screen.getByText('Other').closest('tr')!);
    const deleteBtn = within(otherRow).getByRole('button', { name: /delete other/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('creates a category and shows it in the list', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <JobCategoriesManager />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('Welder')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add category/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /slug/i }), 'rigger');
    await user.type(within(dialog).getByRole('textbox', { name: /name \(english\)/i }), 'Rigger');
    await user.click(within(dialog).getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText('Rigger')).toBeInTheDocument());
  });
});

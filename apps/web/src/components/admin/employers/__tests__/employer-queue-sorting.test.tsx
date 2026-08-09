import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replaceState = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/admin/employers',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { render } from '../../../../test-utils';
import { db, makeAccessToken, SUPER_ADMIN_USER_ID } from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { listEmployers } from '../../../../lib/api/admin-employers';
import { EmployerQueueTable } from '../EmployerQueueTable';

function loginAsAdmin() {
  const token = makeAccessToken(SUPER_ADMIN_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: SUPER_ADMIN_USER_ID, accessToken: token });
}

describe('employer queue — server-side sorting', () => {
  beforeEach(() => {
    loginAsAdmin();
    replaceState.mockClear();
    vi.spyOn(window.history, 'replaceState').mockImplementation(replaceState);
    window.history.pushState({}, '', '/en/admin/employers?status=ALL');
  });
  afterEach(() => {
    resetClient();
    vi.restoreAllMocks();
  });

  it('the API sorts by name, ascending and descending', async () => {
    const asc = await listEmployers({ sort: 'name:asc', pageSize: 50 });
    const desc = await listEmployers({ sort: 'name:desc', pageSize: 50 });

    const ascNames = asc.data.map((c) => c.name);
    expect(ascNames).toEqual([...ascNames].sort((a, b) => a.localeCompare(b)));
    expect(desc.data.map((c) => c.name)).toEqual([...ascNames].reverse());
  });

  it('echoes the APPLIED sort, clamping a field that is not whitelisted', async () => {
    // The security property: an arbitrary column must never be honoured. The
    // server falls back to the default instead of erroring, so a stale
    // bookmark still renders a list.
    const res = await listEmployers({ sort: 'registrationNumber:asc' });
    expect(res.meta.sort).toBe('created:asc');
  });

  it('renders sortable column headers with the right aria-sort', async () => {
    window.history.pushState({}, '', '/en/admin/employers?status=ALL&sort=name:asc');
    render(<EmployerQueueTable />);

    const header = await screen.findByRole('columnheader', { name: /company/i }, { timeout: 3000 });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
  });

  it('clicking a header writes sort to the URL and drops the page', async () => {
    // Sorting re-orders the whole result set, so staying on a later page would
    // show an arbitrary slice of a different ordering — `page` must be dropped.
    // Page 1 (not 3) because the table renders no headers when a page is empty,
    // and the assertion here is about the URL, not about pagination.
    window.history.pushState({}, '', '/en/admin/employers?status=ALL&page=1');
    render(<EmployerQueueTable />);

    const btn = await screen.findByRole(
      'button',
      { name: /sort by .*company/i },
      { timeout: 3000 },
    );
    await userEvent.click(btn);

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = replaceState.mock.calls.at(-1)![2] as string;
    expect(url).toContain('sort=name%3Aasc');
    expect(url).not.toContain('page=');
  });
});

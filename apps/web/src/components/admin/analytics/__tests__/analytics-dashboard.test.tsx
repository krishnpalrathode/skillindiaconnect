import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../../test-utils';
import { db, makeAccessToken, SUPER_ADMIN_USER_ID } from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AnalyticsDashboard } from '../AnalyticsDashboard';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

function signInAsSuperAdmin() {
  const token = makeAccessToken(SUPER_ADMIN_USER_ID);
  db.sessions.set(token, { userId: SUPER_ADMIN_USER_ID, accessToken: token });
  setAccessToken(token);
}

beforeEach(() => resetClient());
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

/**
 * These pin the behaviours the OLD AdminKpis/QueueCards components carried
 * before this dashboard replaced them. The components are gone; the guarantees
 * are not, and a rewrite is exactly when they get dropped by accident.
 */
describe('AnalyticsDashboard — the guarantees inherited from the old dashboard', () => {
  it('formats revenue from INTEGER SUBUNITS (never computes an amount)', async () => {
    signInAsSuperAdmin();
    render(<AnalyticsDashboard />);

    // The tile exists and shows a rupee amount — the server sends subunits and
    // money.ts formats them; the client must never do the arithmetic.
    await waitFor(() => expect(screen.getByText('Revenue invoiced')).toBeInTheDocument());
    const tile = screen.getByText('Revenue invoiced').parentElement;
    expect(tile?.textContent).toMatch(/₹/);
  });

  it('each queue deep-links WITH its status filter, under the locale prefix', async () => {
    signInAsSuperAdmin();
    render(<AnalyticsDashboard />);

    const employerQueue = await screen.findByRole('link', {
      name: /Employers awaiting review:/,
    });
    expect(employerQueue).toHaveAttribute('href', '/en/admin/employers?status=PENDING');

    const jobQueue = screen.getByRole('link', { name: /Jobs awaiting review:/ });
    expect(jobQueue).toHaveAttribute('href', '/en/admin/jobs?status=PENDING_REVIEW');

    const appQueue = screen.getByRole('link', { name: /Applications still pending:/ });
    expect(appQueue).toHaveAttribute('href', '/en/admin/applications?status=PENDING');
  });

  it('carries the count inside the accessible name, not as a loose sibling node', async () => {
    signInAsSuperAdmin();
    render(<AnalyticsDashboard />);

    // Either a number or "Nothing waiting" — never a bare label with the count
    // stranded in a separate, unassociated element.
    const queue = await screen.findByRole('link', { name: /Employers awaiting review:/ });
    expect(queue.getAttribute('aria-label')).toMatch(
      /Employers awaiting review: (\d[\d,]*|Nothing waiting)/,
    );
  });

  it('renders the range filter with the default 30-day window selected', async () => {
    signInAsSuperAdmin();
    render(<AnalyticsDashboard />);

    const preset = await screen.findByRole('button', { name: /Last 30 days/ });
    expect(preset).toHaveAttribute('aria-pressed', 'true');
  });

  it('states what it cannot measure instead of leaving the gaps unexplained', async () => {
    signInAsSuperAdmin();
    render(<AnalyticsDashboard />);

    await waitFor(() =>
      expect(screen.getByText(/What this dashboard can't tell you yet/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Job views and view-to-apply conversion/)).toBeInTheDocument();
  });
});

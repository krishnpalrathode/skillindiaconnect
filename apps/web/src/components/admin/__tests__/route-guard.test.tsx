import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../test-utils';
import { AdminRouteGuard } from '../AdminRouteGuard';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: vi.fn() }),
  // A DEEP link, deliberately not the dashboard — the guard must send `next`
  // back to where the visitor was aiming (S6 pass finding: it used to hardcode
  // the dashboard and lose every admin deep link through a login round-trip).
  usePathname: () => '/en/admin/settings',
  useSearchParams: () => new URLSearchParams(),
}));

// The guard reads useAuth() synchronously; stub it per-test rather than driving
// the whole login flow — the guard's job is the role decision, nothing else.
let mockAuth: { user: { role: string } | null; isLoading: boolean };
vi.mock('../../../lib/auth/auth-context', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useAuth: () => mockAuth };
});

beforeEach(() => {
  replaceMock.mockClear();
  mockAuth = { user: null, isLoading: false };
});
afterEach(() => vi.clearAllMocks());

describe('AdminRouteGuard', () => {
  it('an admin-side role is admitted', async () => {
    mockAuth = { user: { role: 'ADMIN' }, isLoading: false };
    render(
      <AdminRouteGuard>
        <div>admin content</div>
      </AdminRouteGuard>,
    );
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('MODERATOR is admitted (the console is for {SUPER_ADMIN, ADMIN, MODERATOR})', () => {
    mockAuth = { user: { role: 'MODERATOR' }, isLoading: false };
    render(
      <AdminRouteGuard>
        <div>admin content</div>
      </AdminRouteGuard>,
    );
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('an anonymous visitor is redirected to login with a next back to WHERE THEY WERE AIMING', async () => {
    mockAuth = { user: null, isLoading: false };
    render(
      <AdminRouteGuard>
        <div>admin content</div>
      </AdminRouteGuard>,
    );
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/en/login?next=${encodeURIComponent('/en/admin/settings')}`,
      ),
    );
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });

  it('a logged-in EMPLOYER is NOT silently bounced — they get a plain not-authorized panel that says what happened', () => {
    mockAuth = { user: { role: 'EMPLOYER' }, isLoading: false };
    render(
      <AdminRouteGuard>
        <div>admin content</div>
      </AdminRouteGuard>,
    );
    // No teleport into the employer shell…
    expect(replaceMock).not.toHaveBeenCalled();
    // …an honest, announced explanation instead.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('This area is for administrators')).toBeInTheDocument();
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });

  it('a CANDIDATE likewise gets the not-authorized panel', () => {
    mockAuth = { user: { role: 'CANDIDATE' }, isLoading: false };
    render(
      <AdminRouteGuard>
        <div>admin content</div>
      </AdminRouteGuard>,
    );
    expect(screen.getByText('This area is for administrators')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

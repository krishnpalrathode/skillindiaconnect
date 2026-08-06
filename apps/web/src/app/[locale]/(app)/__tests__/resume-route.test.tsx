/**
 * CR-001 F1 — the Resume Builder becomes a DESTINATION.
 *
 * Two things are worth testing here and one thing is not:
 *
 *  - The nav entry exists AND survives on mobile. The whole point of this unit
 *    is discoverability for candidates on cheap Android phones; an entry that
 *    only renders in the desktop sidebar would pass a naive test while failing
 *    the goal. So the mobile bar is asserted explicitly, at 5 items.
 *  - The mobile label is ABBREVIATED but the ACCESSIBLE NAME is not. Shortening
 *    visible text to fit five columns must not shorten what a screen reader
 *    announces.
 *  - Onboarding-unbroken is NOT re-tested here: resume.test.tsx already asserts
 *    PreviewExportStep's "Save & Continue reaches /dashboard without a resume".
 *    Duplicating it would create a second place to update.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReplace = vi.fn();
let mockPathname = '/en/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => mockPathname,
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { screen, waitFor, within } from '@testing-library/react';
import { render } from '../../../../test-utils';
import { db, makeAccessToken } from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import AppLayout from '../layout';
// AppLayout's sign-out button reads useLogoutConfirm(), and that provider reads
// useToast() — the real app supplies both from app/[locale]/layout.tsx. Supplied
// here so the shell can be rendered in isolation; this file already mocks
// next/navigation, which the provider needs.
import { LogoutConfirmProvider } from '../../../../lib/auth/logout-confirm';
import { ToastProvider } from '../../../../components/ui/toast';
import ResumeBuilderPage from '../resume/page';

const CANDIDATE = 'mock-user-candidate-1';

function loginAs(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}

/** Both navs share the "Main navigation" name; the mobile bar is the second. */
async function renderShell() {
  render(
    // AppLayout's sign-out button reads useLogoutConfirm(), which the real app
    // provides from app/[locale]/layout.tsx. Supplied here so the shell can be
    // rendered in isolation; this file already mocks next/navigation, which the
    // provider needs.
    <ToastProvider>
      <LogoutConfirmProvider>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </LogoutConfirmProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.getAllByRole('navigation').length).toBeGreaterThan(1));
  const navs = screen.getAllByRole('navigation', { name: /main navigation/i });
  return { sidebar: navs[0]!, mobileBar: navs[navs.length - 1]! };
}

describe('F1 — Resume Builder navigation entry', () => {
  beforeEach(() => {
    resetClient();
    mockReplace.mockClear();
    mockPathname = '/en/dashboard';
    loginAs(CANDIDATE);
  });

  it('appears in the desktop sidebar and links to the standalone page', async () => {
    const { sidebar } = await renderShell();
    const link = within(sidebar).getByRole('link', { name: /resume builder/i });
    expect(link).toHaveAttribute('href', '/en/resume');
  });

  it('SURVIVES ON MOBILE — the bar carries five items including Resume Builder', async () => {
    // The bar was widened from 4 to 5 for exactly this entry. A regression to
    // slice(0, 4) would silently drop it on the devices our users actually have.
    const { mobileBar } = await renderShell();
    const links = within(mobileBar).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(within(mobileBar).getByRole('link', { name: /resume builder/i })).toHaveAttribute(
      'href',
      '/en/resume',
    );
  });

  it('abbreviates the mobile LABEL without abbreviating the ACCESSIBLE NAME', async () => {
    const { mobileBar } = await renderShell();
    const link = within(mobileBar).getByRole('link', { name: 'Resume Builder' });
    // Visible text is the short form; the accessible name (asserted by the
    // getByRole query above) is still the full one.
    expect(link).toHaveTextContent('Resume');
    expect(link).not.toHaveTextContent('Resume Builder');
  });

  it('marks itself as the current page on /resume', async () => {
    mockPathname = '/en/resume';
    const { sidebar } = await renderShell();
    expect(within(sidebar).getByRole('link', { name: /resume builder/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('F1 — the standalone Resume Builder page', () => {
  beforeEach(() => {
    resetClient();
    mockReplace.mockClear();
    mockPathname = '/en/resume';
  });

  it('renders its own framing and mounts the shared export hub', async () => {
    loginAs(CANDIDATE);
    render(<ResumeBuilderPage />);

    expect(
      await screen.findByRole('heading', { name: /resume builder/i, level: 1 }),
    ).toBeInTheDocument();
    // The hub is the feature; the page is a wrapper. Its settings panel landing
    // is proof the SAME component mounted, not a reimplementation.
    await waitFor(() => expect(screen.getByText(/resume settings/i)).toBeInTheDocument());
  });

  it('sends a non-candidate to their own home instead of showing the builder', async () => {
    loginAs('mock-user-employer-1');
    render(<ResumeBuilderPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace.mock.calls[0]![0]).not.toContain('/resume');
  });
});

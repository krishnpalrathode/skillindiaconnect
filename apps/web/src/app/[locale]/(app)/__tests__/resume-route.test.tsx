/**
 * CR-001 F1 — the Resume Builder becomes a DESTINATION.
 *
 * ── Updated by M1 (the phone app shell) ──────────────────────────────────────
 * The guarantee is unchanged and still the point of this file: a candidate on a
 * cheap Android phone must be able to reach the Resume Builder. What changed is
 * WHERE. The phone bar is now four tabs (Home · Jobs · Applications · Profile),
 * so Resume Builder moved into the app header's overflow menu rather than
 * losing its place entirely — which is what a literal four-tab reading would
 * have done, and would have made it unreachable on phones altogether, since the
 * sidebar that also carries it is desktop-only.
 *
 * The abbreviation test that used to live here is gone with its subject: at
 * five items the bar needed a shortened "Resume" label with the full accessible
 * name preserved. At four items the labels fit as they are, and the menu item
 * carries the full text, so visible text and accessible name are simply the
 * same string and there is no divergence left to guard.
 *
 * Onboarding-unbroken is NOT re-tested here: resume.test.tsx already asserts
 * PreviewExportStep's "Save & Continue reaches /dashboard without a resume".
 * Duplicating it would create a second place to update.
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
import userEvent from '@testing-library/user-event';
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

/** Both navs share the "Main navigation" name, so the bar is found by test id. */
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
  return { sidebar: navs[0]!, mobileBar: screen.getByTestId('mobile-tab-bar') };
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

  /**
   * The guarantee CR-001 actually cares about, restated for the four-tab shell.
   *
   * The sidebar is desktop-only, so if the phone chrome does not carry Resume
   * Builder somewhere, it is not reachable on a phone at all — which is the
   * regression this test exists to catch, wherever the entry point happens to
   * live.
   */
  it('SURVIVES ON MOBILE — reachable from the app header, with the full name', async () => {
    const user = userEvent.setup();
    await renderShell();

    await user.click(screen.getByRole('button', { name: /more options/i }));

    const link = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Resume Builder',
    });
    expect(link).toHaveAttribute('href', '/en/resume');
  });

  it('keeps the phone tab bar to the four specified destinations', async () => {
    const { mobileBar } = await renderShell();
    expect(within(mobileBar).getAllByRole('link')).toHaveLength(4);
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

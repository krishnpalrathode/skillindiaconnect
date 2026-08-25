import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { setAccessToken } from '@/lib/api/client';
import { db, makeAccessToken } from '@/mocks/data';
import { MobileTabBar, buildMobileTabs } from '../MobileTabBar';
import { MobileAppHeader } from '../MobileAppHeader';

const USER_ID = 'mock-user-candidate-1';

const push = vi.fn();
let mockPathname = '/en/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const requestLogout = vi.fn();
vi.mock('@/lib/auth/logout-confirm', () => ({
  useLogoutConfirm: () => ({ requestLogout }),
}));

beforeEach(() => {
  push.mockClear();
  requestLogout.mockClear();
  mockPathname = '/en/dashboard';
  const token = makeAccessToken(USER_ID);
  db.sessions.set(token, { userId: USER_ID, accessToken: token });
  setAccessToken(token);
});

/** The label lookup the real layout does, with the real EN messages. */
function tabsFor(pathname: string) {
  const labels: Record<string, string> = {
    home: 'Home',
    jobs: 'Jobs',
    applications: 'Applications',
    profile: 'Profile',
  };
  return buildMobileTabs('en', pathname, (k) => labels[k] ?? k);
}

describe('MobileTabBar', () => {
  it('is a navigation landmark with the four specified destinations', () => {
    render(<MobileTabBar tabs={tabsFor('/en/dashboard')} />);
    const nav = screen.getByRole('navigation');
    const links = within(nav).getAllByRole('link');

    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/en/dashboard',
      '/en/jobs',
      '/en/applications',
      '/en/profile',
    ]);
  });

  it.each([
    ['/en/dashboard', 'Home'],
    ['/en/jobs', 'Jobs'],
    ['/en/applications', 'Applications'],
    ['/en/profile', 'Profile'],
  ])('marks the current tab on %s', (pathname, expectedLabel) => {
    render(<MobileTabBar tabs={tabsFor(pathname)} />);
    const current = screen.getByRole('link', { current: 'page' });
    expect(current).toHaveTextContent(expectedLabel);
  });

  it('marks exactly one tab current — never two, never none', () => {
    render(<MobileTabBar tabs={tabsFor('/en/jobs')} />);
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
  });

  /**
   * WCAG 1.4.1. Colour alone would be invisible to a candidate with a
   * colour-vision deficiency, so the active state carries a shape (the accent
   * underline) and a weight change as well. This asserts the non-colour
   * signals exist independently of any hue.
   */
  it('conveys the active state beyond colour — underline and weight', () => {
    const { container } = render(<MobileTabBar tabs={tabsFor('/en/jobs')} />);

    const underlines = container.querySelectorAll('span[aria-hidden="true"].opacity-100');
    expect(underlines).toHaveLength(1);

    const current = screen.getByRole('link', { current: 'page' });
    expect(current.querySelector('.font-semibold')).not.toBeNull();
  });

  /**
   * The bar sits over the system gesture bar on a modern phone. Without the
   * inset the bottom of every tap target is unreachable.
   */
  it('pads itself by the safe-area inset', () => {
    const { container } = render(<MobileTabBar tabs={tabsFor('/en/dashboard')} />);
    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('is hidden at desktop widths — one tree, responsive only', () => {
    const { container } = render(<MobileTabBar tabs={tabsFor('/en/dashboard')} />);
    expect(container.querySelector('nav')?.className).toContain('lg:hidden');
  });

  it('gives every tab a target at least 44px tall', () => {
    render(<MobileTabBar tabs={tabsFor('/en/dashboard')} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-[56px]');
    }
  });
});

describe('MobileAppHeader', () => {
  it('routes the search into the EXISTING job search with the existing param', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    await user.type(screen.getByLabelText('Search jobs'), 'welder');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/en/jobs?q=welder');
  });

  it('escapes the query rather than building a broken URL', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    await user.type(screen.getByLabelText('Search jobs'), 'heavy & light');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/en/jobs?q=heavy%20%26%20light');
  });

  it('an empty search goes to the unfiltered list, not ?q=', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    await user.type(screen.getByLabelText('Search jobs'), '   ');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/en/jobs');
  });

  /**
   * The count comes from the notifications endpoint's `meta.total` under
   * `unread=true` — the same source the notifications page reads. A badge that
   * disagrees with the page it links to is worse than no badge.
   */
  it("the bell's accessible name carries the real unread count", async () => {
    render(<MobileAppHeader locale="en" />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /notifications, \d+ unread/i })).toBeInTheDocument(),
    );
  });

  it('links the bell to the notifications route', async () => {
    render(<MobileAppHeader locale="en" />);
    const bell = await screen.findByRole('link', { name: /notifications/i });
    expect(bell).toHaveAttribute('href', '/en/notifications');
  });

  // ── The overflow menu ────────────────────────────────────────────────────
  //
  // Resume Builder, language and sign-out are reachable ONLY from this chrome
  // on a phone: the sidebar that holds them is desktop-only. These tests are
  // the guard against a future four-tab tidy-up stranding them again.

  it('keeps Resume Builder, language and sign-out reachable on a phone', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');

    expect(within(menu).getByRole('menuitem', { name: /resume builder/i })).toHaveAttribute(
      'href',
      '/en/resume',
    );
    expect(within(menu).getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    // The existing switcher, not a reimplementation.
    expect(within(menu).getByLabelText(/select language/i)).toBeInTheDocument();
  });

  it('reports its expanded state', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    const button = screen.getByRole('button', { name: 'More options' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  /**
   * A menu dismissable only by choosing from it is a trap on touch, where
   * there is no click-away instinct.
   */
  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    const button = screen.getByRole('button', { name: 'More options' });
    await user.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('signs out through the existing confirm flow, not a bare logout', async () => {
    const user = userEvent.setup();
    render(<MobileAppHeader locale="en" />);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));

    expect(requestLogout).toHaveBeenCalled();
  });

  it('is hidden at desktop widths — one tree, responsive only', () => {
    const { container } = render(<MobileAppHeader locale="en" />);
    expect(container.querySelector('header')?.className).toContain('lg:hidden');
  });

  /**
   * The installed TWA paints the status bar from the manifest's theme_color.
   * If the header drifts off that token the two stop meeting and a seam shows
   * across the top of the phone.
   */
  it('takes its navy from the same token as the manifest theme_color', () => {
    const { container } = render(<MobileAppHeader locale="en" />);
    expect(container.querySelector('header')?.className).toContain('bg-primary-700');
  });
});

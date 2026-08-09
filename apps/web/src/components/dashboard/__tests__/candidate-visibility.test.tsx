import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test-utils';
import { KpiCards } from '../KpiCards';
import { RecentViewersCard } from '../RecentViewersCard';
import { NotificationItem } from '../../notifications/NotificationItem';
import { db, makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { listNotifications } from '../../../lib/api/notifications';
import type { CandidateStats } from '../../../lib/api/dashboard';
import type { ProfileViewsSummary } from '../../../lib/api/profile-views';
import type { components } from '@skillindiaconnect/shared-types';

type Notification = components['schemas']['Notification'];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/dashboard',
  useParams: () => ({ locale: 'en' }),
}));

const STATS: CandidateStats = { applied: 3, profileViews: 0, shortlisted: 1 };

function summary(overrides?: Partial<ProfileViewsSummary>): ProfileViewsSummary {
  return {
    total: 4,
    last30Days: 4,
    recentViews: [
      {
        companyName: 'Gulf Builders Arabia',
        viewedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
      {
        companyName: 'TechBuild Solutions',
        viewedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      },
    ],
    ...overrides,
  };
}

function notif(overrides: Partial<Notification>): Notification {
  return {
    id: 'n-1',
    type: 'PROFILE_REMINDER',
    title: 'Title',
    body: 'Body',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetClient();
});

// ─── Profile Views KPI ──────────────────────────────────────────────────────────

describe('KpiCards — Profile Views', () => {
  it('renders last30Days with the "last 30 days" caption and a same-page tap target', () => {
    render(<KpiCards stats={STATS} unreadCount={2} profileViews={summary({ last30Days: 7 })} />);

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('last 30 days')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /7 profile views, last 30 days/i });
    expect(link).toHaveAttribute('href', '#recent-views');
  });

  it('shows a quiet dash (not 0) when the fetch failed', () => {
    render(<KpiCards stats={STATS} unreadCount={2} profileViews={null} />);
    // A failed fetch renders a quiet dash — never a fabricated "0 views" that
    // would be indistinguishable from a real zero.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a loading skeleton while profile-views is undefined', () => {
    const { container } = render(
      <KpiCards stats={STATS} unreadCount={0} profileViews={undefined} />,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});

// ─── RecentViewersCard ──────────────────────────────────────────────────────────

describe('RecentViewersCard', () => {
  it('renders company name + relative time rows', () => {
    render(<RecentViewersCard summary={summary()} />);
    expect(screen.getByRole('heading', { name: /recent profile views/i })).toBeInTheDocument();
    expect(screen.getByText('Gulf Builders Arabia')).toBeInTheDocument();
    expect(screen.getByText('TechBuild Solutions')).toBeInTheDocument();
    // Relative time is present (localized) — at least one <time> element
    expect(document.querySelector('time')).toBeInTheDocument();
  });

  it('renders an empty state linking to /profile when there are no views', () => {
    render(<RecentViewersCard summary={summary({ recentViews: [] })} />);
    expect(screen.getByText(/no profile views yet/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /complete profile/i });
    expect(cta).toHaveAttribute('href', '/en/profile');
  });

  it('degrades to the empty state when the summary is null (fetch failed)', () => {
    render(<RecentViewersCard summary={null} />);
    expect(screen.getByText(/no profile views yet/i)).toBeInTheDocument();
  });

  it('exposes the #recent-views anchor for the KPI tap target', () => {
    const { container } = render(<RecentViewersCard summary={summary()} />);
    expect(container.querySelector('#recent-views')).toBeInTheDocument();
  });
});

// ─── Notification rendering (mappings) ───────────────────────────────────────────

describe('NotificationItem — PROFILE_VIEWED / PASSPORT_EXPIRY', () => {
  it('PROFILE_VIEWED renders the server copy, links to the viewers surface, no receipt', () => {
    render(
      <NotificationItem
        notification={notif({
          id: 'pv',
          type: 'PROFILE_VIEWED',
          title: 'Your profile was viewed',
          body: 'Gulf Builders Arabia viewed your profile.',
        })}
        onMarkRead={vi.fn()}
      />,
    );
    expect(screen.getByText('Gulf Builders Arabia viewed your profile.')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/dashboard#recent-views');
    // In-app only → never a delivery receipt
    expect(screen.queryByText(/delivered|sent|receipt/i)).not.toBeInTheDocument();
  });

  it('PASSPORT_EXPIRY (expiring) shows the days-remaining copy and routes to profile documents', () => {
    render(
      <NotificationItem
        notification={notif({
          id: 'pe',
          type: 'PASSPORT_EXPIRY',
          title: 'Passport expiring soon',
          body: 'Your passport expires in 7 days (11 Jul 2026).',
        })}
        onMarkRead={vi.fn()}
      />,
    );
    expect(screen.getByText(/expires in 7 days/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/profile#documents');
  });

  it('PASSPORT_EXPIRY (expired) renders the expired copy', () => {
    render(
      <NotificationItem
        notification={notif({
          id: 'pe2',
          type: 'PASSPORT_EXPIRY',
          title: 'Passport expired',
          body: 'Your passport has expired. Update it to keep applying.',
        })}
        onMarkRead={vi.fn()}
      />,
    );
    expect(screen.getByText(/has expired/i)).toBeInTheDocument();
  });

  it('regression: an unmapped-action type falls back and renders without a link', () => {
    render(
      <NotificationItem
        notification={notif({
          id: 'sys',
          // A type not present in notificationMeta (e.g. a future enum value) must
          // hit fallbackNotificationMeta — render, but with no route/link.
          type: 'FUTURE_UNMAPPED_TYPE' as Notification['type'],
          title: 'Platform Update',
          body: 'Hi',
        })}
        onMarkRead={vi.fn()}
      />,
    );
    expect(screen.getByText('Platform Update')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

// ─── Bucket mapping (MSW) ────────────────────────────────────────────────────────

describe('Profile filter bucket (MSW)', () => {
  it('includes PROFILE_VIEWED and PASSPORT_EXPIRY in the Profile tab', async () => {
    const token = makeAccessToken('mock-user-candidate-1');
    setAccessToken(token);
    db.sessions.set(token, { userId: 'mock-user-candidate-1', accessToken: token });

    const res = await listNotifications({ filter: 'profile', pageSize: 50 });
    const types = res.data.map((n) => n.type);
    expect(types).toContain('PROFILE_VIEWED');
    expect(types).toContain('PASSPORT_EXPIRY');
    // The bucket must not leak unrelated types
    expect(types).not.toContain('JOB_MATCH');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { NotificationFilters } from '../NotificationFilters';
import { NotificationItem } from '../NotificationItem';
import { NotificationList } from '../NotificationList';
import { db, makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';

type Notification = components['schemas']['Notification'];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/notifications',
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/lib/auth/auth-context', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/auth-context')>();
  return {
    ...mod,
    useAuth: () => ({
      user: { id: 'mock-user-candidate-1', email: 'amir@example.com', role: 'CANDIDATE' as const },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const UNREAD_NOTIFICATION: Notification = {
  id: 'test-notif-1',
  type: 'JOB_MATCH',
  title: 'New Job Match',
  body: 'A mason role in Dubai matches your skills.',
  read: false,
  readAt: null,
  relatedEntityId: 'job-1',
  relatedEntityType: 'job',
  createdAt: new Date().toISOString(),
};

const READ_NOTIFICATION: Notification = {
  id: 'test-notif-2',
  type: 'APPLICATION_UPDATE',
  title: 'Application Shortlisted',
  body: 'Your application has been shortlisted.',
  read: true,
  readAt: new Date(Date.now() - 86_400_000).toISOString(),
  relatedEntityId: 'app-1',
  relatedEntityType: 'application',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
};

beforeEach(() => {
  const token = makeAccessToken('mock-user-candidate-1');
  setAccessToken(token);
  db.sessions.set(token, { userId: 'mock-user-candidate-1', accessToken: token });
});

afterEach(() => {
  resetClient();
});

// ─── NotificationFilters ──────────────────────────────────────────────────────

describe('NotificationFilters', () => {
  it('renders all filter tabs', () => {
    render(
      <NotificationFilters
        activeFilter={undefined}
        unreadOnly={false}
        onFilterChange={vi.fn()}
        onUnreadToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /applications/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^jobs$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /system/i })).toBeInTheDocument();
  });

  it('marks the active filter tab as selected', () => {
    render(
      <NotificationFilters
        activeFilter="jobs"
        unreadOnly={false}
        onFilterChange={vi.fn()}
        onUnreadToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: /^jobs$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^all$/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onFilterChange when a tab is clicked', async () => {
    const onFilterChange = vi.fn();
    render(
      <NotificationFilters
        activeFilter={undefined}
        unreadOnly={false}
        onFilterChange={onFilterChange}
        onUnreadToggle={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /applications/i }));
    expect(onFilterChange).toHaveBeenCalledWith('applications');
  });

  it('shows unread only checkbox', () => {
    render(
      <NotificationFilters
        activeFilter={undefined}
        unreadOnly={false}
        onFilterChange={vi.fn()}
        onUnreadToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /unread only/i })).toBeInTheDocument();
  });
});

// ─── NotificationItem ─────────────────────────────────────────────────────────

describe('NotificationItem', () => {
  it('renders notification title and body', () => {
    render(<NotificationItem notification={UNREAD_NOTIFICATION} onMarkRead={vi.fn()} />);
    expect(screen.getByText('New Job Match')).toBeInTheDocument();
    expect(screen.getByText(/mason role in dubai/i)).toBeInTheDocument();
  });

  it('shows unread indicator for unread notifications', () => {
    render(<NotificationItem notification={UNREAD_NOTIFICATION} onMarkRead={vi.fn()} />);
    expect(screen.getByLabelText('Unread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
  });

  it('does not show unread indicator for read notifications', () => {
    render(<NotificationItem notification={READ_NOTIFICATION} onMarkRead={vi.fn()} />);
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark as read/i })).not.toBeInTheDocument();
  });

  it('calls onMarkRead when mark as read button is clicked', async () => {
    const onMarkRead = vi.fn();
    render(<NotificationItem notification={UNREAD_NOTIFICATION} onMarkRead={onMarkRead} />);
    await userEvent.click(screen.getByRole('button', { name: /mark as read/i }));
    expect(onMarkRead).toHaveBeenCalledWith('test-notif-1');
  });

  it('renders a link when relatedEntityType is job', () => {
    render(<NotificationItem notification={UNREAD_NOTIFICATION} onMarkRead={vi.fn()} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/jobs/job-1');
  });
});

// ─── NotificationList ─────────────────────────────────────────────────────────

describe('NotificationList', () => {
  it('loads and displays notifications from the API', async () => {
    render(<NotificationList />);
    await waitFor(() => {
      expect(
        screen.getAllByText(/job match|application|platform update|complete your profile/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows the mark all read button when there are unread notifications', async () => {
    render(<NotificationList />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument();
    });
  });

  it('shows date group headers', async () => {
    render(<NotificationList />);
    await waitFor(() => {
      const headers = screen.getAllByRole('heading');
      expect(
        headers.some((h) => /today|yesterday|this week|older/i.test(h.textContent ?? '')),
      ).toBe(true);
    });
  });

  it('optimistically marks a notification as read', async () => {
    render(<NotificationList />);
    const markReadButtons = await screen.findAllByRole('button', { name: /mark as read/i });
    expect(markReadButtons.length).toBeGreaterThan(0);

    const firstButton = markReadButtons[0]!;
    await userEvent.click(firstButton);

    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /mark as read/i }).length).toBeLessThan(
        markReadButtons.length,
      );
    });
  });

  it('shows empty state for unread-only filter when all are read', async () => {
    // Mark all as read first via MSW mutation
    const { db: mockDb } = await import('../../../mocks/data');
    const notifs = mockDb.notifications.get('mock-user-candidate-1') ?? [];
    notifs.forEach((n) => {
      n.read = true;
      n.readAt = new Date().toISOString();
    });

    render(<NotificationList />);

    // Switch to unread-only
    const checkbox = await screen.findByRole('checkbox', { name: /unread only/i });
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByText(/no unread notifications/i)).toBeInTheDocument();
    });

    // Restore state
    notifs.forEach((n, i) => {
      if (i >= 1) {
        n.read = false;
        n.readAt = null;
      }
    });
  });
});

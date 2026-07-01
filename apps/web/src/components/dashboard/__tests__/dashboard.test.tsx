import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test-utils';
import { KpiCards } from '../KpiCards';
import { ProfileSummaryCard } from '../ProfileSummaryCard';
import { QuickActions } from '../QuickActions';
import { MyApplicationsMini } from '../MyApplicationsMini';
import { RecommendedJobs } from '../RecommendedJobs';
import { db, makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];
type JobCard = components['schemas']['JobCard'];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/dashboard',
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

const MOCK_PROFILE = {
  id: 'mock-user-candidate-1',
  email: 'amir@example.com',
  role: 'CANDIDATE',
  fullName: 'Amir Khan',
  completionPct: 65,
  profileVisible: true,
  isAvailable: true,
} as CandidateProfile;

const MOCK_COMPLETION: CompletionResult = {
  pct: 65,
  sections: [],
  canApply: false,
  missingForApply: [],
};

const MOCK_JOB: JobCard = {
  id: 'job-1',
  title: 'Experienced Mason',
  market: 'GULF',
  location: 'Dubai, UAE',
  salaryCurrency: 'AED',
  salaryMin: 1200,
  salaryMax: 1800,
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  companyName: 'Gulf Builders Arabia',
  createdAt: new Date().toISOString(),
  isSaved: false,
};

beforeEach(() => {
  const token = makeAccessToken('mock-user-candidate-1');
  setAccessToken(token);
  db.sessions.set(token, { userId: 'mock-user-candidate-1', accessToken: token });
});

afterEach(() => {
  resetClient();
});

// ─── KpiCards ─────────────────────────────────────────────────────────────────

describe('KpiCards', () => {
  it('renders all four KPI values', () => {
    render(<KpiCards stats={{ applied: 3, profileViews: 12, shortlisted: 1 }} unreadCount={2} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders all four KPI labels', () => {
    render(<KpiCards stats={{ applied: 0, profileViews: 0, shortlisted: 0 }} unreadCount={0} />);
    expect(screen.getByText('Jobs Applied')).toBeInTheDocument();
    expect(screen.getByText('Profile Views')).toBeInTheDocument();
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    expect(screen.getByText('Updates')).toBeInTheDocument();
  });

  it('Updates card links to /en/notifications', () => {
    render(<KpiCards stats={{ applied: 0, profileViews: 0, shortlisted: 0 }} unreadCount={5} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/en/notifications');
  });
});

// ─── ProfileSummaryCard ───────────────────────────────────────────────────────

describe('ProfileSummaryCard', () => {
  it('shows candidate name', () => {
    render(<ProfileSummaryCard profile={MOCK_PROFILE} completion={MOCK_COMPLETION} />);
    expect(screen.getByText('Amir Khan')).toBeInTheDocument();
  });

  it('shows completion percentage', () => {
    render(<ProfileSummaryCard profile={MOCK_PROFILE} completion={MOCK_COMPLETION} />);
    expect(screen.getByText('65% complete')).toBeInTheDocument();
  });

  it('shows "complete now" link when not 100%', () => {
    render(<ProfileSummaryCard profile={MOCK_PROFILE} completion={MOCK_COMPLETION} />);
    expect(screen.getByRole('link', { name: /complete now/i })).toBeInTheDocument();
  });

  it('hides "complete now" when profile is 100%', () => {
    const fullCompletion: CompletionResult = { ...MOCK_COMPLETION, pct: 100 };
    render(<ProfileSummaryCard profile={MOCK_PROFILE} completion={fullCompletion} />);
    expect(screen.queryByRole('link', { name: /complete now/i })).not.toBeInTheDocument();
  });

  it('shows initials avatar', () => {
    render(<ProfileSummaryCard profile={MOCK_PROFILE} completion={MOCK_COMPLETION} />);
    expect(screen.getByText('AK')).toBeInTheDocument();
  });
});

// ─── QuickActions ─────────────────────────────────────────────────────────────

describe('QuickActions', () => {
  it('renders three quick action links', () => {
    render(<QuickActions />);
    expect(screen.getByRole('link', { name: /complete profile/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse jobs/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view notifications/i })).toBeInTheDocument();
  });
});

// ─── MyApplicationsMini ───────────────────────────────────────────────────────

describe('MyApplicationsMini', () => {
  it('shows coming soon message', () => {
    render(<MyApplicationsMini />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});

// ─── RecommendedJobs ──────────────────────────────────────────────────────────

describe('RecommendedJobs', () => {
  it('renders job cards', () => {
    render(<RecommendedJobs jobs={[MOCK_JOB]} />);
    expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
  });

  it('shows empty state when no jobs', () => {
    render(<RecommendedJobs jobs={[]} />);
    expect(screen.getByText(/no recommendations yet/i)).toBeInTheDocument();
  });

  it('shows view all link', () => {
    render(<RecommendedJobs jobs={[]} />);
    expect(screen.getByRole('link', { name: /browse all jobs/i })).toBeInTheDocument();
  });
});

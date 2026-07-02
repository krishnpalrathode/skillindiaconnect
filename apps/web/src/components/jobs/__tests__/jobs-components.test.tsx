import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { BenefitChips } from '../BenefitChips';
import { JobFilters } from '../JobFilters';
import { JobList } from '../JobList';
import { SaveJobButton } from '../SaveJobButton';
import { JobDetail } from '../JobDetail';
import { EMPTY_FILTERS } from '@/lib/jobs/searchParams';
import { db, makeAccessToken, toJobDetail } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { server } from '../../../mocks/server';
import { http, HttpResponse } from 'msw';

// ─── Mock next/navigation ────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/en/jobs',
  useParams: () => ({ locale: 'en' }),
}));

// ─── Mock useAuth ─────────────────────────────────────────────────────────────
// AuthProvider's bootstrap doRefresh() calls the auth/refresh endpoint, which
// has no cookie in tests and returns 401, so user stays null. We mock useAuth
// directly to control auth state without the async bootstrap dance.

const mockAuthUser = vi.fn(() => null);

vi.mock('@/lib/auth/auth-context', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/auth-context')>();
  return {
    ...mod,
    useAuth: () => ({
      user: mockAuthUser(),
      isLoading: false,
      login: vi.fn(),
      loginWithPhone: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
    }),
    // Passthrough AuthProvider so NextIntlClientProvider still wraps correctly.
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CANDIDATE_USER_ID = 'mock-user-candidate-1';

function loginAsCandidate() {
  const token = makeAccessToken(CANDIDATE_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: CANDIDATE_USER_ID, accessToken: token });
  mockAuthUser.mockReturnValue({
    id: CANDIDATE_USER_ID,
    email: 'amir@example.com',
    role: 'CANDIDATE' as const,
  });
}

// ─── BenefitChips ────────────────────────────────────────────────────────────

describe('BenefitChips', () => {
  it('shows Accommodation/Transport/Food chips for GULF job', () => {
    render(
      <BenefitChips
        job={{ market: 'GULF', accommodation: true, transportation: true, healthInsurance: true }}
      />,
    );
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.queryByText('PF')).not.toBeInTheDocument();
  });

  it('shows PF/Bonus/ESI chips for LOCAL job', () => {
    render(
      <BenefitChips
        job={{ market: 'LOCAL', accommodation: true, transportation: true, healthInsurance: true }}
      />,
    );
    expect(screen.getByText('PF')).toBeInTheDocument();
    expect(screen.getByText('Bonus')).toBeInTheDocument();
    expect(screen.getByText('ESI')).toBeInTheDocument();
    expect(screen.queryByText('Accommodation')).not.toBeInTheDocument();
  });

  it('renders only chips for benefits that are true', () => {
    render(
      <BenefitChips
        job={{ market: 'GULF', accommodation: true, transportation: false, healthInsurance: false }}
      />,
    );
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.queryByText('Transport')).not.toBeInTheDocument();
    expect(screen.queryByText('Food')).not.toBeInTheDocument();
  });

  it('returns nothing when all benefits are false', () => {
    const { container } = render(
      <BenefitChips
        job={{
          market: 'GULF',
          accommodation: false,
          transportation: false,
          healthInsurance: false,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ─── JobFilters URL sync ──────────────────────────────────────────────────────

describe('JobFilters', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('navigates with category filter when a chip is clicked', async () => {
    const user = userEvent.setup();
    render(<JobFilters filters={EMPTY_FILTERS} locale="en" />);

    await user.click(screen.getByRole('button', { name: /construction/i }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('category=cat-construction'));
  });

  it('deselects a category chip on second click', async () => {
    const user = userEvent.setup();
    const filtersWithCategory = { ...EMPTY_FILTERS, category: 'cat-construction' };
    render(<JobFilters filters={filtersWithCategory} locale="en" />);

    await user.click(screen.getByRole('button', { name: /construction/i }));

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('category='));
  });

  it('shows Clear filters button only when a filter is active', () => {
    const { rerender } = render(<JobFilters filters={EMPTY_FILTERS} locale="en" />);
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();

    rerender(
      <JobFilters filters={{ ...EMPTY_FILTERS, category: 'cat-construction' }} locale="en" />,
    );
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });
});

// ─── JobList load-more ────────────────────────────────────────────────────────

describe('JobList', () => {
  // Build a tiny cursor-paginated fixture: 2 jobs in page 1, 1 more on page 2.
  const job1 = db.jobs.get('job-1')!;
  const job2 = db.jobs.get('job-2')!;
  const job3 = db.jobs.get('job-5')!;

  const mkCard = (job: typeof job1) => ({
    id: job.id,
    title: job.title,
    market: job.market,
    location: job.location,
    companyName: job.companyName,
    salaryCurrency: job.salaryCurrency,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    accommodation: job.accommodation,
    healthInsurance: job.healthInsurance,
    transportation: job.transportation,
    createdAt: job.createdAt,
    publishedAt: job.publishedAt ?? null,
    isSaved: null,
  });

  const page1 = { data: [mkCard(job1), mkCard(job2)], nextCursor: btoa('cursor-1') };
  const page2 = { data: [mkCard(job3)], nextCursor: null };

  beforeEach(() => {
    // Override getJobs for the load-more (second page) fetch only.
    server.use(
      http.get('/api/v1/jobs', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('cursor')) {
          return HttpResponse.json(page2);
        }
        // First page is provided via SSR (initialData); client should only call with cursor.
        return HttpResponse.json(page1);
      }),
    );
  });

  it('shows initial jobs and result count', () => {
    render(<JobList initialData={page1} filters={EMPTY_FILTERS} locale="en" />);
    expect(screen.getByTestId('job-result-count')).toBeInTheDocument();
    expect(screen.getByText(/Experienced Mason/i)).toBeInTheDocument();
  });

  it('loads next page on "Load more" click and appends results', async () => {
    const user = userEvent.setup();
    render(<JobList initialData={page1} filters={EMPTY_FILTERS} locale="en" />);

    // Count "View details" links — one per card. BenefitChips renders <li> items
    // that would contaminate an getAllByRole('listitem') count, but each card has
    // exactly one "View details" link so that's a reliable card-count proxy.
    expect(screen.getAllByRole('link', { name: /view details/i })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      // Page 1 (2) + page 2 (1) = 3 cards total.
      expect(screen.getAllByRole('link', { name: /view details/i })).toHaveLength(3);
    });
  });

  it('shows empty state when no jobs returned', () => {
    render(
      <JobList initialData={{ data: [], nextCursor: null }} filters={EMPTY_FILTERS} locale="en" />,
    );
    expect(screen.getByText(/no jobs found/i)).toBeInTheDocument();
  });

  it('shows retry button on load-more error', async () => {
    server.use(
      http.get('/api/v1/jobs', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('cursor')) {
          return HttpResponse.json(
            { code: 'SERVER_ERROR', status: 500, title: 'Error', detail: 'err' },
            { status: 500 },
          );
        }
        return HttpResponse.json(page1);
      }),
    );

    const user = userEvent.setup();
    render(<JobList initialData={page1} filters={EMPTY_FILTERS} locale="en" />);

    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});

// ─── SaveJobButton ────────────────────────────────────────────────────────────

describe('SaveJobButton', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockAuthUser.mockReturnValue(null);
  });

  afterEach(() => {
    resetClient();
    db.savedJobs.delete(CANDIDATE_USER_ID);
    mockAuthUser.mockReturnValue(null);
  });

  it('redirects to login when logged out', async () => {
    const user = userEvent.setup();
    render(<SaveJobButton jobId="job-2" initialSaved={null} variant="full" />);

    await user.click(screen.getByRole('button', { name: /save job/i }));

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/login'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('next='));
  });

  it('optimistically toggles saved state when logged in', async () => {
    loginAsCandidate();
    const user = userEvent.setup();
    render(<SaveJobButton jobId="job-2" initialSaved={false} variant="full" />);

    expect(screen.getByRole('button', { name: /save job/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save job/i }));

    // After click, label changes to "Saved" (unsave mode).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument();
    });
  });

  it('toggles back to unsaved when clicking again', async () => {
    loginAsCandidate();
    // job-1 is already saved for this user in the mock db.
    db.savedJobs.set(CANDIDATE_USER_ID, new Set(['job-1']));
    const user = userEvent.setup();
    render(<SaveJobButton jobId="job-1" initialSaved={true} variant="full" />);

    expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /saved/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save job/i })).toBeInTheDocument();
    });
  });
});

// ─── JobDetail ────────────────────────────────────────────────────────────────

describe('JobDetail', () => {
  const job1 = db.jobs.get('job-1')!;
  const detail = toJobDetail(job1, null, db.jobs);

  it('renders the job title as a heading', () => {
    render(<JobDetail job={detail} locale="en" />);
    expect(screen.getByRole('heading', { name: /experienced mason/i })).toBeInTheDocument();
  });

  it('renders salary range', () => {
    render(<JobDetail job={detail} locale="en" />);
    // AED 1,200–1,800 — similar jobs may also show AED, so use getAllByText.
    expect(screen.getAllByText(/AED/).length).toBeGreaterThan(0);
  });

  it('renders benefit chips for a GULF job', () => {
    render(<JobDetail job={detail} locale="en" />);
    // job-1 has all three benefits = true and market = GULF. Similar jobs
    // may also render Accommodation chips, so use getAllByText.
    expect(screen.getAllByText('Accommodation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Transport').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Food').length).toBeGreaterThan(0);
  });

  it('renders requirements as a list', () => {
    render(<JobDetail job={detail} locale="en" />);
    expect(screen.getByRole('heading', { name: /requirements/i })).toBeInTheDocument();
    for (const req of detail.requirements ?? []) {
      expect(screen.getByText(req)).toBeInTheDocument();
    }
  });

  it('renders a similar jobs section when similar jobs are present', () => {
    render(<JobDetail job={detail} locale="en" />);
    if ((detail.similarJobs ?? []).length > 0) {
      expect(screen.getByRole('heading', { name: /similar jobs/i })).toBeInTheDocument();
    }
  });

  it('renders the Apply Now link', () => {
    render(<JobDetail job={detail} locale="en" />);
    expect(screen.getByRole('link', { name: /apply now/i })).toBeInTheDocument();
  });
});

// ─── getJobServer 404 behavior ────────────────────────────────────────────────

describe('getJobServer notFound', () => {
  it('rejects with status 404 for an unknown job id (MSW handler)', async () => {
    // This tests the MSW handler contract that page.tsx relies on for notFound().
    const res = await fetch('/api/v1/jobs/nonexistent-id-xyz');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });
});

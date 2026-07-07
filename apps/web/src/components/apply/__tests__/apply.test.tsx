import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { server } from '../../../mocks/server';
import { db, makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient, type ApiError } from '../../../lib/api/client';
import { ApplyButton } from '../ApplyButton';
import { ApplyErrorState } from '../ApplyErrorState';
import { MatchRevealCard } from '../MatchRevealCard';
import { CoverLetterField } from '../CoverLetterField';
import type { components } from '@skillindiaconnect/shared-types';

type JobDetail = components['schemas']['JobDetail'];
type Application = components['schemas']['Application'];

const BASE = `${window.location.origin}/api/v1`;
const CAND = 'mock-user-candidate-1';

// ── useAuth mock (candidate) ────────────────────────────────────────────────
let mockAuth: { user: { id: string; email: string; role: string } | null; isLoading: boolean };
vi.mock('../../../lib/auth/auth-context', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useAuth: () => mockAuth };
});

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  const base = {
    id: 'job-1',
    title: 'Experienced Mason',
    companyName: 'Gulf Builders Arabia',
    market: 'GULF',
    location: 'Abu Dhabi, UAE',
    salaryMin: 1200,
    salaryMax: 1800,
    salaryCurrency: 'AED',
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...overrides } as JobDetail;
}

const APP: Application = {
  id: 'app-x',
  humanId: 'AP-2026-7',
  jobId: 'job-1',
  candidateId: CAND,
  status: 'PENDING',
  matchScore: 79,
  matchBreakdown: {
    category: { score: 40, max: 40 },
    experienceYears: { raw: 6, clamped: 6, score: 18, max: 30 },
    foreignExperience: { score: 20, max: 20 },
    documents: { score: 10, max: 10 },
  },
  coverLetter: null,
  docsCompleteCount: 2,
  docsRequiredCount: 2,
  passportValidAtApply: true,
  selectedNotifiedAt: null,
  rejectionFeedback: null,
  appliedAt: new Date().toISOString(),
};

function eligible() {
  server.use(
    http.get(`${BASE}/candidates/me/completion`, () =>
      HttpResponse.json({ data: { pct: 85, sections: [], canApply: true, missingForApply: [] } }),
    ),
    http.get(`${BASE}/candidates/me/applications`, () =>
      HttpResponse.json({ data: [], nextCursor: null }),
    ),
  );
}

beforeEach(() => {
  resetClient();
  const token = makeAccessToken(CAND);
  setAccessToken(token);
  db.sessions.set(token, { userId: CAND, accessToken: token });
  mockAuth = { user: { id: CAND, email: 'amir@example.com', role: 'CANDIDATE' }, isLoading: false };
});

// ── Full flow: eligible → sheet → submit → reveal ───────────────────────────
describe('ApplyButton — eligible flow', () => {
  it('CTA → sheet → submit → 201 reveal with the payload score + components', async () => {
    eligible();
    server.use(
      http.post(`${BASE}/jobs/job-1/apply`, () =>
        HttpResponse.json({ data: APP }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    render(<ApplyButton job={job()} locale="en" />);

    const cta = await screen.findByRole('button', { name: /apply now/i });
    await user.click(cta);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /submit application/i }));

    // Reveal: exact score + a component score from the payload.
    expect(await screen.findByText("You're a 79% match")).toBeInTheDocument();
    expect(screen.getByText('AP-2026-7')).toBeInTheDocument();
    expect(screen.getByText('18/30')).toBeInTheDocument(); // experience component
    expect(screen.getByRole('link', { name: /track in my applications/i })).toHaveAttribute(
      'href',
      '/en/applications',
    );
  });
});

// ── Ineligible → preview checklist with fix links ───────────────────────────
describe('ApplyButton — ineligible', () => {
  it('CTA reads "complete profile" and opens the preview checklist with fix links', async () => {
    server.use(
      http.get(`${BASE}/candidates/me/completion`, () =>
        HttpResponse.json({
          data: {
            pct: 55,
            sections: [],
            canApply: false,
            missingForApply: [
              'Complete at least 70% of your profile',
              'Verified passport document required',
            ],
          },
        }),
      ),
      http.get(`${BASE}/candidates/me/applications`, () =>
        HttpResponse.json({ data: [], nextCursor: null }),
      ),
    );
    const user = userEvent.setup();
    render(<ApplyButton job={job()} locale="en" />);

    const cta = await screen.findByRole('button', { name: /complete your profile to apply/i });
    await user.click(cta);

    expect(await screen.findByText(/your profile is 55% complete/i)).toBeInTheDocument();
    // passport item → /profile#documents; completion item → /profile
    const fixLinks = screen.getAllByRole('link', { name: /fix/i });
    const targets = fixLinks.map((l) => l.getAttribute('href'));
    expect(targets).toContain('/en/profile');
    expect(targets).toContain('/en/profile#documents');
  });
});

// ── Stale preview ≠ enforcement ─────────────────────────────────────────────
describe('ApplyButton — preview is not enforcement', () => {
  it('canApply=true but the server rejects → the error state still renders', async () => {
    eligible();
    server.use(
      http.post(`${BASE}/jobs/job-1/apply`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'x',
            status: 422,
            code: 'PROFILE_INCOMPLETE',
            detail: 'x',
            meta: { completionPct: 60, threshold: 70 },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ApplyButton job={job()} locale="en" />);
    await user.click(await screen.findByRole('button', { name: /apply now/i }));
    await user.click(await screen.findByRole('button', { name: /submit application/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/60% — 70%/);
  });
});

// ── 409 → applied state ─────────────────────────────────────────────────────
describe('ApplyButton — already applied (409)', () => {
  it('a 409 on submit flips the entry to "Applied"', async () => {
    eligible();
    server.use(
      http.post(`${BASE}/jobs/job-1/apply`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'x', status: 409, code: 'ALREADY_APPLIED', detail: 'x' },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ApplyButton job={job()} locale="en" />);
    await user.click(await screen.findByRole('button', { name: /apply now/i }));
    await user.click(await screen.findByRole('button', { name: /submit application/i }));

    // onApplied fires → the entry becomes the "Applied" link to My Applications.
    const applied = await screen.findByRole('link', { name: /applied/i });
    expect(applied).toHaveAttribute('href', '/en/applications');
  });

  it('on revisit (already in the feed) the entry shows "Applied" without submitting', async () => {
    server.use(
      http.get(`${BASE}/candidates/me/completion`, () =>
        HttpResponse.json({ data: { pct: 85, sections: [], canApply: true, missingForApply: [] } }),
      ),
      http.get(`${BASE}/candidates/me/applications`, () =>
        HttpResponse.json({
          data: [
            {
              id: 'app-1',
              humanId: 'AP-2026-1',
              job: { id: 'job-1', title: 'x', companyName: 'y', location: 'z', market: 'GULF' },
              status: 'PENDING',
              matchScore: 70,
              appliedAt: new Date().toISOString(),
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<ApplyButton job={job()} locale="en" />);
    expect(await screen.findByRole('link', { name: /applied/i })).toHaveAttribute(
      'href',
      '/en/applications',
    );
  });
});

// ── Logged-out → login redirect ─────────────────────────────────────────────
describe('ApplyButton — logged out', () => {
  it('renders a login link with next back to the job', async () => {
    mockAuth = { user: null, isLoading: false };
    render(<ApplyButton job={job()} locale="en" />);
    const link = await screen.findByRole('link', { name: /apply now/i });
    expect(link).toHaveAttribute('href', '/en/login?next=%2Fen%2Fjobs%2Fjob-1');
  });
});

// ── ApplyErrorState — the five codes → destinations ─────────────────────────
describe('ApplyErrorState — meta-driven destinations', () => {
  const cases: { error: ApiError; text: RegExp; href: string | null }[] = [
    {
      error: {
        code: 'PROFILE_INCOMPLETE',
        status: 422,
        title: '',
        detail: '',
        meta: { completionPct: 55, threshold: 70 },
      },
      text: /55% — 70%/,
      href: '/en/profile',
    },
    {
      error: {
        code: 'MANDATORY_DOCS_MISSING',
        status: 422,
        title: '',
        detail: '',
        meta: { missing: ['PASSPORT', 'EXPERIENCE_CERT'] },
      },
      text: /Passport, Experience certificate/,
      href: '/en/profile#documents',
    },
    {
      error: {
        code: 'PASSPORT_INVALID',
        status: 422,
        title: '',
        detail: '',
        meta: { reason: 'expired' },
      },
      text: /expired/i,
      href: '/en/profile#documents',
    },
    {
      error: { code: 'ALREADY_APPLIED', status: 409, title: '', detail: '' },
      text: /already applied/i,
      href: '/en/applications',
    },
    {
      error: { code: 'JOB_NOT_ACTIVE', status: 422, title: '', detail: '' },
      text: /no longer accepting/i,
      href: '/en/jobs',
    },
  ];
  it.each(cases)('$error.code → link $href', ({ error, text, href }) => {
    render(<ApplyErrorState error={error} locale="en" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    if (href) expect(screen.getByRole('link')).toHaveAttribute('href', href);
  });

  it('unknown code → generic retry (no link, calls onRetry)', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ApplyErrorState
        error={{ code: 'WEIRD', status: 500, title: '', detail: '' }}
        locale="en"
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

// ── MatchRevealCard — foreign-0-on-LOCAL note ───────────────────────────────
describe('MatchRevealCard', () => {
  it('shows the "not scored for local jobs" note when foreign=0 on a LOCAL market', () => {
    const localApp: Application = {
      ...APP,
      matchBreakdown: { ...APP.matchBreakdown, foreignExperience: { score: 0, max: 20 } },
    };
    render(<MatchRevealCard application={localApp} jobMarket="LOCAL" locale="en" />);
    expect(screen.getByText(/not scored for local jobs/i)).toBeInTheDocument();
    expect(screen.getByText('0/20')).toBeInTheDocument();
  });

  it('no note on a GULF job with foreign score', () => {
    render(<MatchRevealCard application={APP} jobMarket="GULF" locale="en" />);
    expect(screen.queryByText(/not scored for local jobs/i)).toBeNull();
  });
});

// ── CoverLetterField — counter blocks >500 ──────────────────────────────────
describe('CoverLetterField', () => {
  it('blocks input beyond 500 chars and shows the live counter', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = React.useState('');
      return <CoverLetterField value={v} onChange={setV} />;
    }
    render(<Harness />);
    const textarea = screen.getByLabelText(/cover letter/i) as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute('maxlength', '500');
    await user.type(textarea, 'hello');
    expect(screen.getByText('5/500')).toBeInTheDocument();
  });
});

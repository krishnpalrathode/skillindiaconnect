import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../i18n/messages/en.json';
import {
  db,
  makeAccessToken,
  EMPLOYER_APPROVED_USER_ID,
  NOT_WHATSAPP_CAPABLE_USER_ID,
} from '../../../mocks/data';
import { server } from '../../../mocks/server';
import { setAccessToken, resetClient, ApiRequestError } from '../../../lib/api/client';
import { browseCandidates, getCandidate } from '../../../lib/api/employer-candidates';
import {
  buildCandidateQuery,
  EMPTY_CANDIDATE_FILTERS,
} from '../../../lib/employer/candidateFilters';
import { CandidateFacts } from '../candidates/view/CandidateFacts';
import { CandidateViewHeader } from '../candidates/view/CandidateViewHeader';
import { DocumentsStatusCard } from '../candidates/view/DocumentsStatusCard';
import { CandidateBrowseCard } from '../candidates/CandidateBrowseCard';
import type { components } from '@skillindiaconnect/shared-types';

type CandidateEmployerView = components['schemas']['CandidateEmployerView'];
type CandidateBrowseCardModel = components['schemas']['CandidateBrowseCard'];

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/employer/candidates',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

function I18n({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

function loginAsApprovedEmployer() {
  const token = makeAccessToken(EMPLOYER_APPROVED_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: EMPLOYER_APPROVED_USER_ID, accessToken: token });
}

function baseView(overrides?: Partial<CandidateEmployerView>): CandidateEmployerView {
  return {
    id: 'cand-1',
    fullName: 'Rajan Patel',
    isAvailable: true,
    documentsStatus: [],
    memberSince: '2025-01-15T00:00:00.000Z',
    nationality: 'Indian',
    currentLocation: 'Surat',
    jobCategoryId: 'cat-construction',
    noticePeriod: 30,
    languages: ['Hindi', 'English'],
    ...overrides,
  };
}

beforeEach(() => {
  resetClient();
});

// ─── The privacy mirror ─────────────────────────────────────────────────────────

describe('CandidateFacts — privacy mirror', () => {
  it('renders a phone row when phone is present', () => {
    render(
      <I18n>
        <CandidateFacts candidate={baseView({ phone: '+919876543210' })} />
      </I18n>,
    );
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
  });

  it('renders NO phone row and NO phone label when phone is absent', () => {
    render(
      <I18n>
        <CandidateFacts candidate={baseView()} />
      </I18n>,
    );
    // Absence of the LABEL, not just the value — a hidden field must not reveal
    // its own existence.
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
  });

  it('omits religion by default (no row, no label)', () => {
    render(
      <I18n>
        <CandidateFacts candidate={baseView()} />
      </I18n>,
    );
    expect(screen.queryByText('Religion')).not.toBeInTheDocument();
  });

  it('renders a religion row only when religion is present', () => {
    render(
      <I18n>
        <CandidateFacts candidate={baseView({ religion: 'Hindu' })} />
      </I18n>,
    );
    expect(screen.getByText('Religion')).toBeInTheDocument();
    expect(screen.getByText('Hindu')).toBeInTheDocument();
  });
});

describe('CandidateViewHeader', () => {
  it('renders derived age (never a birthdate) when age is present', () => {
    render(
      <I18n>
        <CandidateViewHeader candidate={baseView({ age: 32 })} locale="en" />
      </I18n>,
    );
    expect(screen.getByText('32 years old')).toBeInTheDocument();
  });

  it('renders no age text when age is absent', () => {
    render(
      <I18n>
        <CandidateViewHeader candidate={baseView()} locale="en" />
      </I18n>,
    );
    expect(screen.queryByText(/years old/)).not.toBeInTheDocument();
    // memberSince still renders from createdAt
    expect(screen.getByText(/Member since/)).toBeInTheDocument();
  });
});

// ─── Documents: status only, nothing clickable ──────────────────────────────────

describe('DocumentsStatusCard', () => {
  it('shows an Expired badge for an expired passport', () => {
    render(
      <I18n>
        <DocumentsStatusCard
          candidateId="test-candidate"
          documentsStatus={[{ type: 'PASSPORT', uploaded: true, passportValid: false }]}
        />
      </I18n>,
    );
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('shows a Valid badge for a valid passport', () => {
    render(
      <I18n>
        <DocumentsStatusCard
          candidateId="test-candidate"
          documentsStatus={[{ type: 'PASSPORT', uploaded: true, passportValid: true }]}
        />
      </I18n>,
    );
    expect(screen.getByText('Valid')).toBeInTheDocument();
  });

  it('renders a View button for uploaded docs (S5-F2 Pro gate)', () => {
    render(
      <I18n>
        <DocumentsStatusCard
          candidateId="test-candidate"
          documentsStatus={[{ type: 'PASSPORT', uploaded: true, passportValid: true }]}
        />
      </I18n>,
    );
    // DocumentViewButton renders a "View" button for each uploaded doc
    expect(screen.getByRole('button', { name: /view passport document/i })).toBeInTheDocument();
  });

  it('marks a missing mandatory type as not uploaded', () => {
    render(
      <I18n>
        <DocumentsStatusCard candidateId="test-candidate" documentsStatus={[]} />
      </I18n>,
    );
    expect(screen.getAllByText('Not uploaded').length).toBeGreaterThan(0);
  });
});

// ─── Browse card: subset fields only ────────────────────────────────────────────

describe('CandidateBrowseCard', () => {
  function card(overrides?: Partial<CandidateBrowseCardModel>): CandidateBrowseCardModel {
    return {
      id: 'cand-1',
      fullName: 'Amir Khan',
      isAvailable: true,
      hasForeignExperience: true,
      nationality: 'Indian',
      currentLocation: 'Mumbai',
      jobCategoryId: 'cat-construction',
      experienceYears: 4,
      skills: ['Masonry', 'Plastering'],
      ...overrides,
    };
  }

  it('links to the candidate view and shows the Gulf-experience badge', () => {
    render(
      <I18n>
        <CandidateBrowseCard candidate={card()} />
      </I18n>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/en/employer/candidates/cand-1');
    expect(screen.getByText('Gulf experience')).toBeInTheDocument();
    expect(screen.getByText('Masonry')).toBeInTheDocument();
  });

  it('renders no Gulf badge when hasForeignExperience is false', () => {
    render(
      <I18n>
        <CandidateBrowseCard candidate={card({ hasForeignExperience: false })} />
      </I18n>,
    );
    expect(screen.queryByText('Gulf experience')).not.toBeInTheDocument();
  });
});

// ─── Filter param contract ──────────────────────────────────────────────────────

describe('buildCandidateQuery', () => {
  it('maps the whitelisted filters to the API params', () => {
    const qs = buildCandidateQuery({
      category: 'cat-electrical',
      minExperienceYears: 3,
      foreignOnly: true,
      availableOnly: true,
      q: 'welder',
    });
    const params = new URLSearchParams(qs);
    expect(params.get('category')).toBe('cat-electrical');
    expect(params.get('minExperienceYears')).toBe('3');
    expect(params.get('hasForeignExperience')).toBe('true');
    expect(params.get('availability')).toBe('true');
    expect(params.get('q')).toBe('welder');
  });

  it('omits toggles that are off', () => {
    const qs = buildCandidateQuery(EMPTY_CANDIDATE_FILTERS);
    expect(qs).toBe('');
  });
});

// ─── MSW-backed browse + view (privacy behaviors encoded in the mocks) ───────────

describe('browse + view (MSW)', () => {
  it('never returns a profileVisible=false candidate', async () => {
    loginAsApprovedEmployer();
    const res = await browseCandidates(EMPTY_CANDIDATE_FILTERS, { pageSize: 50 });
    const names = res.data.map((c) => c.fullName);
    expect(names).toContain('Rajan Patel');
    expect(names).not.toContain('Hidden User');
  });

  it('omits phone for a showPhone=false candidate', async () => {
    loginAsApprovedEmployer();
    const view = await getCandidate(NOT_WHATSAPP_CAPABLE_USER_ID); // Priya Sharma
    expect('phone' in view).toBe(false);
  });

  it('includes phone for a showPhone=true candidate', async () => {
    loginAsApprovedEmployer();
    const view = await getCandidate('mock-user-candidate-1'); // Amir Khan
    expect(view.phone).toBe('+919876543210');
  });

  it('returns an identical 404 for a hidden and a nonexistent candidate', async () => {
    loginAsApprovedEmployer();
    const hidden = await getCandidate('mock-user-candidate-hidden').catch((e) => e);
    const missing = await getCandidate('does-not-exist').catch((e) => e);
    expect(hidden).toBeInstanceOf(ApiRequestError);
    expect(missing).toBeInstanceOf(ApiRequestError);
    expect((hidden as ApiRequestError).error.status).toBe(404);
    expect((missing as ApiRequestError).error.status).toBe(404);
  });
});

describe('view makes no tracking call beyond the GET', () => {
  afterEach(() => server.events.removeAllListeners());

  it('issues exactly one request — the candidate GET', async () => {
    loginAsApprovedEmployer();
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => urls.push(request.url));

    await getCandidate('mock-user-candidate-1');

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/employers/candidates/mock-user-candidate-1');
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '@/test-utils';
import { server } from '@/mocks/server';
import { db, makeAccessToken } from '@/mocks/data';
import { setAccessToken, resetClient } from '@/lib/api/client';
import ApplicantsPage from '../page';
import type { components } from '@skillindiaconnect/shared-types';

type ApplicantCardT = components['schemas']['ApplicantCard'];

const BASE = `${window.location.origin}/api/v1`;
const EMP = 'mock-user-employer-1';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en', id: 'job-1' }),
}));

vi.mock('@/lib/employer/employer-context', () => ({
  useEmployer: () => ({
    company: { id: 'mock-company-1', name: 'Gulf Builders', status: 'APPROVED' },
    isLoading: false,
  }),
}));

function applicantCard(overrides: Partial<ApplicantCardT> = {}): ApplicantCardT {
  return {
    id: 'cand-2',
    fullName: 'Rajan Patel',
    isAvailable: true,
    documentsStatus: [{ type: 'PASSPORT', uploaded: true, passportValid: true }],
    createdAt: new Date().toISOString(),
    applicationId: 'app-5',
    humanId: 'AP-2026-5',
    status: 'PENDING',
    matchScore: 65,
    matchBreakdown: {
      category: { score: 40, max: 40 },
      experienceYears: { raw: 5, clamped: 5, score: 15, max: 30 },
      foreignExperience: { score: 0, max: 20 },
      documents: { score: 10, max: 10 },
    },
    appliedAt: new Date().toISOString(),
    ...overrides,
  };
}

const COUNTS = { pending: 1, shortlisted: 0, selected: 0, rejected: 0 };

beforeEach(() => {
  resetClient();
  const token = makeAccessToken(EMP);
  setAccessToken(token);
  db.sessions.set(token, { userId: EMP, accessToken: token });
});

describe('Applicants pipeline — optimistic + 422 rollback', () => {
  it('lists applicants and reconciles a stale illegal move (422 → rollback + toast + server truth)', async () => {
    let getCount = 0;
    server.use(
      // First load → PENDING. Reload (after 422) → SELECTED (a concurrent admin move).
      http.get(`${BASE}/jobs/job-1/applicants`, () => {
        getCount++;
        const status = getCount === 1 ? 'PENDING' : 'SELECTED';
        return HttpResponse.json({
          data: [applicantCard({ status })],
          nextCursor: null,
          counts: getCount === 1 ? COUNTS : { ...COUNTS, pending: 0, selected: 1 },
        });
      }),
      // The employer's optimistic Shortlist is illegal server-side (state advanced).
      http.patch(`${BASE}/applications/app-5/status`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Illegal transition',
            status: 422,
            code: 'ILLEGAL_TRANSITION',
            detail: 'x',
            meta: { from: 'SELECTED', to: 'SHORTLISTED', allowed: [] },
          },
          { status: 422 },
        ),
      ),
    );

    const user = userEvent.setup();
    render(<ApplicantsPage />);

    // Applicant renders (PENDING) with a Shortlist action.
    const shortlist = await screen.findByRole('button', { name: /shortlist rajan/i });
    await user.click(shortlist);

    // 422 → the reconciliation toast fires + the server truth (SELECTED) renders.
    await waitFor(() => expect(screen.getByText(/status changed/i)).toBeInTheDocument());
    const list = () => document.getElementById('applicants-list')!;
    await waitFor(() => expect(within(list()).getByText('Selected')).toBeInTheDocument());
    // The optimistic Shortlist did not stick (no Shortlisted badge lie on the card).
    expect(within(list()).queryByText('Shortlisted')).toBeNull();
  });

  it('happy path: shortlist reconciles to the server truth', async () => {
    let getCount = 0;
    server.use(
      http.get(`${BASE}/jobs/job-1/applicants`, () => {
        getCount++;
        const status = getCount === 1 ? 'PENDING' : 'SHORTLISTED';
        return HttpResponse.json({
          data: [applicantCard({ status })],
          nextCursor: null,
          counts: getCount === 1 ? COUNTS : { ...COUNTS, pending: 0, shortlisted: 1 },
        });
      }),
      http.patch(`${BASE}/applications/app-5/status`, () =>
        HttpResponse.json({ data: { status: 'SHORTLISTED' } }, { status: 200 }),
      ),
    );

    const user = userEvent.setup();
    render(<ApplicantsPage />);
    await user.click(await screen.findByRole('button', { name: /shortlist rajan/i }));
    const list = () => document.getElementById('applicants-list')!;
    await waitFor(() => expect(within(list()).getByText('Shortlisted')).toBeInTheDocument());
  });
});

/**
 * The public jobs strip on the landing page.
 *
 * This block exists to convert strangers into registrations, so the tests are
 * about the funnel, not the layout:
 *
 *  1. Apply must carry the job forward through the auth wall. A logged-out
 *     visitor taps Apply on a specific job; if `next` is lost they authenticate
 *     and land on a generic screen with no way back to what they wanted. That
 *     is the single largest drop-off in this flow and it is invisible in
 *     manual testing, because whoever is testing already knows which job it was.
 *  2. The listing itself must stay ungated and crawlable — real links, no JS
 *     required — because indexed job pages are how candidates find this product
 *     at all.
 *  3. The salary and the benefits must be on the card. For Gulf blue-collar
 *     hiring they are the decision, not decoration.
 *  4. No jobs must render NOTHING. An empty "latest jobs" heading advertises a
 *     dead marketplace to the exact person we are trying to win.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { screen, within } from '@testing-library/react';
import type { components } from '@skillindiaconnect/shared-types';
import { render } from '../../../test-utils';
import { PublicJobCard } from '../PublicJobCard';

type JobCard = components['schemas']['JobCard'];

const JOB: JobCard = {
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Site Electrician',
  market: 'GULF',
  country: 'United Arab Emirates',
  location: 'Dubai',
  categoryId: null,
  salaryMin: 2000,
  salaryMax: 2600,
  salaryCurrency: 'AED',
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  companyName: 'Gulf Wiring LLC',
  createdAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  isSaved: null,
};

function setup(overrides: Partial<JobCard> = {}) {
  render(
    <ul>
      <PublicJobCard job={{ ...JOB, ...overrides }} locale="en" />
    </ul>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PublicJobCard — the anonymous visitor’s view', () => {
  it('sends Apply to sign-in carrying the job as `next`', () => {
    setup();

    const apply = screen.getByRole('link', { name: /apply now/i });
    const href = apply.getAttribute('href')!;

    expect(href.startsWith('/en/login')).toBe(true);
    // Encoded, not raw: the value is a path and must survive as one parameter.
    expect(href).toContain(`next=${encodeURIComponent(`/en/jobs/${JOB.id}`)}`);
  });

  it('lets a logged-out visitor read the job without an account', () => {
    setup();

    // Both the title and View details are real links to the public detail page
    // — no account, no JS, and crawlable.
    const title = screen.getByRole('link', { name: JOB.title });
    expect(title).toHaveAttribute('href', `/en/jobs/${JOB.id}`);

    const details = screen.getByRole('link', { name: /view details/i });
    expect(details).toHaveAttribute('href', `/en/jobs/${JOB.id}`);
  });

  it('shows the salary and the Gulf benefit chips — the decision, not decoration', () => {
    setup();

    expect(screen.getByText(/2,000/)).toBeInTheDocument();

    // GULF relabels the three benefit booleans as accommodation/transport/food.
    const list = screen.getByRole('list', { name: /benefit/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('still renders without a salary rather than printing an empty line', () => {
    // Salary is optional on the schema, and a card that breaks on a null is a
    // card that breaks on somebody's real listing.
    setup({ salaryMin: null, salaryMax: null });

    expect(screen.getByRole('link', { name: JOB.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /apply now/i })).toBeInTheDocument();
  });

  it('names the company and the country, so the offer is checkable', () => {
    setup();

    expect(screen.getByText(JOB.companyName)).toBeInTheDocument();
    expect(screen.getByText(/Dubai, United Arab Emirates/)).toBeInTheDocument();
  });
});

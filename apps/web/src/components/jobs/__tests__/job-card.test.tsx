import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// next/link asserts the app router is mounted; the card is full of real links.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/jobs',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

import { screen, within } from '@testing-library/react';
import { render } from '../../../test-utils';
import type { JobCard as JobCardType } from '@/lib/api/jobs';
import { JobCard } from '../JobCard';

/**
 * M3 — the job card at phone widths.
 *
 * The styling is the least interesting thing here. What these tests protect is
 * that the card stays truthful and unbroken when the data is not the mockup's
 * data: no salary, a floor but no ceiling, a company name three times longer
 * than "ABC Infrastructure Pvt. Ltd.", every benefit at once. Real postings
 * look like that far more often than they look like a mockup.
 */

const baseJob: JobCardType = {
  id: 'job-1',
  title: 'Shuttering Carpenter',
  market: 'GULF',
  location: 'Dubai',
  salaryMin: 2000,
  salaryMax: 3000,
  salaryCurrency: 'AED',
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  companyName: 'Gulf Build Contracting LLC',
  createdAt: new Date().toISOString(),
} as JobCardType;

const job = (overrides: Partial<JobCardType> = {}): JobCardType =>
  ({ ...baseJob, ...overrides }) as JobCardType;

const card = () => screen.getByRole('article');

describe('JobCard — identity and a11y', () => {
  /**
   * A search page is forty of these in a row. Without a name on each, a screen
   * reader announces forty anonymous groups.
   */
  it('names the card by its job title AND company', () => {
    render(<JobCard job={job()} locale="en" />);
    expect(
      screen.getByRole('article', { name: /shuttering carpenter.*gulf build contracting/i }),
    ).toBeInTheDocument();
  });

  it('gives the Apply CTA a name that distinguishes it from every other card', () => {
    render(<JobCard job={job()} locale="en" />);
    // "Apply now" ×40 is useless when tabbing; the accessible name carries the job.
    expect(
      within(card()).getByRole('link', { name: /apply to shuttering carpenter/i }),
    ).toBeInTheDocument();
  });

  it('routes Apply into the existing flow on the job page, not a second entry point', () => {
    render(<JobCard job={job()} locale="en" />);
    expect(within(card()).getByRole('link', { name: /apply to/i })).toHaveAttribute(
      'href',
      '/en/jobs/job-1',
    );
  });

  /**
   * The image decision, asserted rather than just written down: the card shape
   * carries no image, and inventing one would mean showing a workplace that is
   * not the job.
   */
  it('renders no image — the card shape has none and stock photos would mislead', () => {
    const { container } = render(<JobCard job={job()} locale="en" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the save control — saved jobs are a shipped feature', () => {
    render(<JobCard job={job()} locale="en" />);
    expect(within(card()).getByRole('button', { name: /save job|saved/i })).toBeInTheDocument();
  });
});

describe('JobCard — the benefit chips must survive the restyle', () => {
  /**
   * These are the platform's worker-protection guarantee made visible, and the
   * single thing a redesign is most likely to quietly drop to match a mockup.
   * Both markets are asserted because the SAME three booleans are relabelled by
   * market — a regression could easily keep one set and lose the other.
   */
  it('shows the GULF bundle — accommodation, transport, food', () => {
    render(<JobCard job={job({ market: 'GULF' })} locale="en" />);
    const chips = within(card()).getByRole('list', { name: /included benefits/i });
    expect(within(chips).getByText('Accommodation')).toBeInTheDocument();
    expect(within(chips).getByText('Transport')).toBeInTheDocument();
    expect(within(chips).getByText('Food')).toBeInTheDocument();
  });

  it('shows the LOCAL bundle — PF, Bonus, ESI — from the same three flags', () => {
    render(<JobCard job={job({ market: 'LOCAL' })} locale="en" />);
    const chips = within(card()).getByRole('list', { name: /included benefits/i });
    expect(within(chips).getByText('PF')).toBeInTheDocument();
    expect(within(chips).getByText('Bonus')).toBeInTheDocument();
    expect(within(chips).getByText('ESI')).toBeInTheDocument();
    // …and never the Gulf labels for an India job.
    expect(within(chips).queryByText('Accommodation')).toBeNull();
  });

  it('renders only the benefits the job actually offers', () => {
    render(
      <JobCard
        job={job({
          market: 'GULF',
          accommodation: true,
          transportation: false,
          healthInsurance: false,
        })}
        locale="en"
      />,
    );
    const chips = within(card()).getByRole('list', { name: /included benefits/i });
    expect(within(chips).getByText('Accommodation')).toBeInTheDocument();
    expect(within(chips).queryByText('Transport')).toBeNull();
    expect(within(chips).queryByText('Food')).toBeNull();
  });

  /**
   * Chips carry their meaning as words, not as a colour. A candidate with a
   * colour-vision deficiency reads "Accommodation", not "the green one".
   */
  it('conveys each benefit as text, not colour alone', () => {
    render(<JobCard job={job()} locale="en" />);
    const chips = within(card()).getByRole('list', { name: /included benefits/i });
    for (const item of within(chips).getAllByRole('listitem')) {
      expect(item.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('JobCard — imperfect data', () => {
  it('a job with NO salary simply omits it and still renders', () => {
    render(<JobCard job={job({ salaryMin: null, salaryMax: null })} locale="en" />);
    expect(within(card()).getByText('Shuttering Carpenter')).toBeInTheDocument();
    expect(within(card()).queryByText(/AED/)).toBeNull();
    // The thing the card exists to offer is still there.
    expect(within(card()).getByRole('link', { name: /apply to/i })).toBeInTheDocument();
  });

  /**
   * A floor with no ceiling is common. It must read as one figure, never as a
   * range with a missing half.
   */
  it('a minimum-only salary shows one figure, not a broken range', () => {
    render(<JobCard job={job({ salaryMin: 2000, salaryMax: null })} locale="en" />);
    const text = card().textContent ?? '';
    expect(text).toMatch(/AED/);
    expect(text).not.toMatch(/–\s*$/);
    expect(text).not.toMatch(/AED\s*–/);
  });

  it('a max-only salary shows one figure too', () => {
    render(<JobCard job={job({ salaryMin: null, salaryMax: 3000 })} locale="en" />);
    expect(card().textContent ?? '').toMatch(/AED/);
  });

  it('an equal min and max collapses to a single figure', () => {
    render(<JobCard job={job({ salaryMin: 2500, salaryMax: 2500 })} locale="en" />);
    const matches = (card().textContent ?? '').match(/AED/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  /**
   * The overflow case. A long unbroken company name is what pushes a card past
   * 360px and scrolls the whole page sideways; `break-words` is what stops it,
   * so its absence is the actual regression to catch.
   */
  it('allows very long titles and company names to wrap rather than overflow', () => {
    render(
      <JobCard
        job={job({
          title: 'Senior Shuttering Carpenter and Formwork Supervisor for High-Rise Construction',
          companyName:
            'Al Rashid International Manpower Consultancy and Overseas Recruitment Services Pvt. Ltd.',
        })}
        locale="en"
      />,
    );

    const title = within(card()).getByRole('heading', { level: 3 });
    expect(title.className).toContain('break-words');
    expect(title.textContent).toContain('Formwork Supervisor');

    const company = card().querySelector('p.break-words');
    expect(company).not.toBeNull();
  });

  it('a short title with every chip at once still renders one coherent card', () => {
    render(<JobCard job={job({ title: 'Mason' })} locale="en" />);
    const chips = within(card()).getByRole('list', { name: /included benefits/i });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(3);
    expect(within(card()).getByRole('link', { name: /apply to mason/i })).toBeInTheDocument();
  });
});

describe('JobCard — desktop presentation is preserved', () => {
  /**
   * The phone treatment is the BASE and every desktop value is restored at
   * `sm:`. These assert the restore classes exist, so a future edit that drops
   * one — silently changing the desktop card — fails here rather than in
   * someone's browser.
   */
  it('restores the desktop title size, salary weight and card radius at sm:', () => {
    render(<JobCard job={job()} locale="en" />);

    expect(card().className).toContain('sm:rounded-lg');
    expect(within(card()).getByRole('heading', { level: 3 }).className).toContain('sm:text-base');

    const salary = card().querySelector('p.text-lg.font-bold');
    expect(salary?.className).toContain('sm:text-sm');
    expect(salary?.className).toContain('sm:font-medium');
  });

  it('hides the phone-only Apply CTA at desktop, leaving View details alone', () => {
    render(<JobCard job={job()} locale="en" />);
    expect(within(card()).getByRole('link', { name: /apply to/i }).className).toContain(
      'sm:hidden',
    );
    // View details is NOT phone-only — it is the desktop footer.
    expect(within(card()).getByRole('link', { name: /view details/i }).className).not.toContain(
      'sm:hidden',
    );
  });
});

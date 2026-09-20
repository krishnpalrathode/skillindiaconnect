import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { HeroSearchPanel } from '../HeroSearchPanel';

/**
 * The mobile tabbed search panel. Two things matter here: it is a real,
 * keyboard-operable tablist, and every path it offers routes into the EXISTING
 * public search / signup — it must not fabricate a parallel search or link
 * anywhere invented.
 */
describe('HeroSearchPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('is a real tablist with Find a Job selected by default', () => {
    render(<HeroSearchPanel locale="en" />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /find a job/i })).toHaveAttribute('aria-selected', 'true');
    // The find panel and its labelled search input are shown; hire panel hidden.
    expect(screen.getByLabelText(/job title, skill or keyword/i)).toBeInTheDocument();
  });

  it('switches to Hire Talent on click and routes to employer signup', async () => {
    const user = userEvent.setup();
    render(<HeroSearchPanel locale="en" />);
    await user.click(screen.getByRole('tab', { name: /hire talent/i }));
    expect(screen.getByRole('tab', { name: /hire talent/i })).toHaveAttribute('aria-selected', 'true');
    const cta = screen.getByRole('link', { name: /hire talent/i });
    expect(cta).toHaveAttribute('href', '/en/signup?role=employer');
  });

  it('moves selection with the arrow keys (roving tabindex)', async () => {
    const user = userEvent.setup();
    render(<HeroSearchPanel locale="en" />);
    const find = screen.getByRole('tab', { name: /find a job/i });
    find.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /hire talent/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('the Find-a-Job form targets the existing public /jobs search with real params', () => {
    render(<HeroSearchPanel locale="en" />);
    const input = screen.getByLabelText(/job title, skill or keyword/i);
    const form = input.closest('form')!;
    expect(form).toHaveAttribute('action', '/en/jobs');
    expect(form).toHaveAttribute('method', 'get');
    expect(input).toHaveAttribute('name', 'q');
    expect(screen.getByLabelText(/location/i)).toHaveAttribute('name', 'market');
  });

  it('popular-search chips deep-link into /jobs by real seed category — no invented categories', () => {
    render(<HeroSearchPanel locale="en" />);
    expect(screen.getByRole('link', { name: 'Driver' })).toHaveAttribute(
      'href',
      '/en/jobs?category=driver',
    );
    expect(screen.getByRole('link', { name: 'Welder' })).toHaveAttribute(
      'href',
      '/en/jobs?category=welder',
    );
    // The mockup's non-seed categories were substituted, not invented.
    expect(screen.queryByRole('link', { name: /construction/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /hospitality/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /caregiver/i })).not.toBeInTheDocument();
  });
});

import React from 'react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

import { screen, within } from '@testing-library/react';
import { render } from '../../../test-utils';
import { Hero } from '../Hero';

/**
 * M4 — the logged-out entry screen.
 *
 * The claims on this page are load-bearing: it is read by workers deciding
 * whether to hand this platform their passport scan, often after being asked
 * for three months' wages by an agent. So these tests are mostly about what the
 * page promises and where its buttons actually go, not about how it looks.
 */
describe('Hero — the promise', () => {
  /**
   * The worker-protection guarantee is not marketing. It is a rule the publish
   * gate enforces: a job cannot go live with accommodation, health insurance or
   * transport set to false. Saying it plainly is the strongest thing this page
   * can do, and it must not be quietly softened into a slogan.
   */
  it('leads with the worker-protection guarantee, stated in full', () => {
    render(<Hero locale="en" />);
    const promise = screen.getByText(/every job on skill india connect/i);
    expect(promise).toBeInTheDocument();
    expect(promise.textContent).toMatch(/place to stay/i);
    expect(promise.textContent).toMatch(/health insurance/i);
    expect(promise.textContent).toMatch(/transport/i);
    expect(promise.textContent).toMatch(/check every employer/i);
  });

  it('has exactly one h1, so the heading hierarchy is sane', () => {
    render(<Hero locale="en" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('states three true value points as text, not icon-only', () => {
    render(<Hero locale="en" />);
    const list = screen.getAllByRole('list')[0]!;
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.textContent)).toEqual([
      'Verified Employers',
      'Free for Workers',
      'India & Global Opportunities',
    ]);
  });
});

describe('Hero — where the buttons go', () => {
  /**
   * The change this unit makes. "Find Verified Jobs" used to route to /signup,
   * so the one button promising jobs delivered a registration form. Search is
   * public and crawlable; there is nothing to gate.
   */
  it('sends "Find Verified Jobs" to the public job search, not to signup', () => {
    render(<Hero locale="en" />);
    expect(screen.getByRole('link', { name: /find verified jobs/i })).toHaveAttribute(
      'href',
      '/en/jobs',
    );
  });

  it('sends "Hire Skilled Talent" to employer signup', () => {
    render(<Hero locale="en" />);
    expect(screen.getByRole('link', { name: /hire skilled talent/i })).toHaveAttribute(
      'href',
      '/en/signup?role=employer',
    );
  });

  /**
   * Job search is ALREADY what the primary CTA does, so a third route to the
   * same listings would be a choice with no difference behind it.
   */
  it('offers no "Browse as Guest" third path', () => {
    render(<Hero locale="en" />);
    expect(screen.queryByText(/browse as guest/i)).toBeNull();
    // Two CTAs, no more.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('carries the locale through both CTAs', () => {
    render(<Hero locale="ar" />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/ar\//);
    }
  });
});

describe('Hero — nothing fabricated', () => {
  /**
   * No counts, no testimonials, no "trusted by N workers". Nothing in this app
   * measures any of that, and a figure that cannot be defended is the most
   * expensive decoration a verification platform can put on its front door.
   */
  it('publishes no statistics anywhere on the entry screen', () => {
    const { container } = render(<Hero locale="en" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d[\d,]*\s*\+/); // "25,000+"
    expect(text).not.toMatch(/trusted by/i);
    expect(text).not.toMatch(/\b\d{3,}\b/);
  });
});

describe('Hero — the phone treatment does not cost the desktop one', () => {
  /**
   * Phone styling is the base and every desktop value is restored at `lg`,
   * which is the breakpoint the hero's own grid already switches on. These
   * assert the restore classes exist, so an edit that drops one — silently
   * changing the public desktop landing — fails here rather than in a browser.
   */
  it('restores left alignment and the inline CTA row at lg', () => {
    const { container } = render(<Hero locale="en" />);

    const column = container.querySelector('.text-center');
    expect(column?.className).toContain('lg:text-start');

    const ctaRow = container.querySelector('.animate-hero-rise-scale');
    expect(ctaRow?.className).toContain('lg:justify-start');
  });

  it('shows the mark and wordmark on phone only', () => {
    const { container } = render(<Hero locale="en" />);
    const wordmark = screen.getByText('Skill India Connect');
    // The whole block is lg:hidden — the desktop landing already has the logo
    // in its sticky header.
    expect(wordmark.parentElement?.className).toContain('lg:hidden');
    // Decorative: the wordmark beside it carries the name.
    const mark = container.querySelector('img[aria-hidden="true"]');
    expect(mark).toHaveAttribute('alt', '');
  });
});

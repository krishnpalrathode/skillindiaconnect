import React from 'react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/dashboard',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

import { screen, within } from '@testing-library/react';
import { render } from '../../../test-utils';
import type { components } from '@skillindiaconnect/shared-types';
import { HomeHero } from '../HomeHero';
import { ValueStrip } from '../ValueStrip';
import { CategoryChips } from '../CategoryChips';
import { FeaturedJobs } from '../FeaturedJobs';

type JobCardType = components['schemas']['JobCard'];

/**
 * M2 — the phone home screen.
 *
 * Most of these tests are about honesty rather than layout, because that is
 * where this screen can actually do harm: fabricated statistics, tiles that
 * open nothing, and placeholder job listings are each individually small and
 * collectively the difference between a product and a demo. The people reading
 * this page are deciding whether to hand us their passport scan.
 */

const job = (over: Partial<JobCardType> = {}): JobCardType =>
  ({
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
    ...over,
  }) as JobCardType;

describe('HomeHero', () => {
  it('routes the CTA into the existing job search', () => {
    render(<HomeHero locale="en" />);
    expect(screen.getByRole('link', { name: /search jobs/i })).toHaveAttribute('href', '/en/jobs');
  });

  /**
   * The constrained-device rule, asserted structurally. The CTA is a link in
   * the first frame; the photograph is a lazy, absolutely-positioned decoration
   * that cannot reflow anything when it lands.
   */
  it('loads its image lazily and decoratively, so nothing waits on it', () => {
    const { container } = render(<HomeHero locale="en" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('loading', 'lazy');
    // Decorative: empty alt, hidden from the a11y tree.
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * The mockup showed carousel dots. There is one hero, so dots would indicate
   * nothing and press nothing.
   */
  it('renders no carousel dots for a single hero', () => {
    const { container } = render(<HomeHero locale="en" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('ValueStrip — claims, never counts', () => {
  /**
   * The single most important assertion in this file. The design this came from
   * carried "25,000+", "5,000+", "10,000+" — numbers nothing in this app
   * measures. If one ever gets pasted in here, this fails.
   */
  it('contains no fabricated statistics', () => {
    const { container } = render(<ValueStrip />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d[\d,]*\s*\+/); // "25,000+" and friends
    expect(text).not.toMatch(/\b\d{3,}\b/); // any large bare count
  });

  it('shows four claims about what the worker actually gets', () => {
    render(<ValueStrip />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  /**
   * Three claims are READ from `landing.trust` rather than retyped, so the
   * public page and the signed-in home cannot drift into promising different
   * things. This asserts the shared source is really being used.
   */
  it('reuses the landing page trust claims verbatim', () => {
    render(<ValueStrip />);
    expect(screen.getByText('Verified employers')).toBeInTheDocument();
    expect(screen.getByText('Free for workers')).toBeInTheDocument();
    expect(screen.getByText('Worker protection')).toBeInTheDocument();
  });

  it('carries meaning in text, with the icons decorative', () => {
    const { container } = render(<ValueStrip />);
    for (const icon of container.querySelectorAll('span[aria-hidden="true"]')) {
      expect(icon.textContent?.trim()).toBe('');
    }
  });
});

describe('CategoryChips', () => {
  /**
   * Every slug must be a real `job_categories` row and every tile must link
   * into the existing filtered search. A tile that opens nothing is the thing
   * this section is most likely to become.
   */
  it('links all six tiles into the existing filtered search by real slug', () => {
    render(<CategoryChips locale="en" />);
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links).toHaveLength(6);

    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/en/jobs?category=electrician',
      '/en/jobs?category=mason',
      '/en/jobs?category=hvac-technician',
      '/en/jobs?category=driver',
      '/en/jobs?category=plumber',
      '/en/jobs?category=welder',
    ]);
  });

  it('uses the substituted Mason tile, not a Construction category that does not exist', () => {
    render(<CategoryChips locale="en" />);
    expect(screen.getByText('Mason')).toBeInTheDocument();
    expect(screen.queryByText(/^Construction$/)).toBeNull();
  });

  it('names each tile so identity is not carried by the icon colour', () => {
    render(<CategoryChips locale="en" />);
    for (const link of within(screen.getByRole('list')).getAllByRole('link')) {
      expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('FeaturedJobs', () => {
  it('renders real jobs through the shared search card', () => {
    render(<FeaturedJobs jobs={[job(), job({ id: 'job-2', title: 'Mason' })]} locale="en" />);
    // role="article" is M3's card — proof the same component is reused.
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: /apply to shuttering carpenter/i }),
    ).toBeInTheDocument();
  });

  it('shows at most three, however many it is handed', () => {
    const many = Array.from({ length: 8 }, (_, i) => job({ id: `job-${i}`, title: `Job ${i}` }));
    render(<FeaturedJobs jobs={many} locale="en" />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('offers a way into the full search', () => {
    render(<FeaturedJobs jobs={[job()]} locale="en" />);
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/en/jobs');
  });

  /**
   * The empty state must SAY there is nothing, never fill the space with
   * placeholder cards. A fabricated listing on a job board is not a loading
   * skeleton — it is a lie to someone looking for work.
   */
  it('says plainly when there are no jobs, and renders no placeholder cards', () => {
    render(<FeaturedJobs jobs={[]} locale="en" />);
    expect(screen.getByText(/no jobs open right now/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    // The way out is still offered.
    expect(screen.getByRole('link', { name: /view all/i })).toBeInTheDocument();
  });
});

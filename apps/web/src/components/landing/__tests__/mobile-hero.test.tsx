import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test-utils';
import { MobileHero } from '../MobileHero';

/**
 * The phone hero that mirrors the marketing mockup. Its claims are load-bearing,
 * so the test asserts on the copy, the promises and where the buttons go — not
 * on pixels.
 */
describe('MobileHero', () => {
  it('leads with the verified pill, the headline and the subline', () => {
    render(<MobileHero locale="en" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /your skills can take you anywhere/i,
    );
    expect(screen.getByText(/100% verified employers/i)).toBeInTheDocument();
    expect(screen.getByText(/safe, verified jobs for skilled workers/i)).toBeInTheDocument();
  });

  it('shows the three feature rows with their true subtitles', () => {
    render(<MobileHero locale="en" />);
    // "Verified Employers" also appears as a stats-bar label, so allow >1.
    expect(screen.getAllByText('Verified Employers').length).toBeGreaterThan(0);
    expect(screen.getByText('Real companies. Real jobs.')).toBeInTheDocument();
    expect(screen.getByText('Free for Workers')).toBeInTheDocument();
    expect(screen.getByText('No registration fees.')).toBeInTheDocument();
    expect(screen.getByText('India & Global Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Build a better future.')).toBeInTheDocument();
  });

  it('routes the two CTAs to the existing job search and signup', () => {
    render(<MobileHero locale="en" />);
    expect(screen.getByRole('link', { name: /find jobs/i })).toHaveAttribute('href', '/en/jobs');
    expect(screen.getByRole('link', { name: /create your profile/i })).toHaveAttribute(
      'href',
      '/en/signup',
    );
  });

  it('shows the stats bar figures', () => {
    render(<MobileHero locale="en" />);
    expect(screen.getByText('1M+')).toBeInTheDocument();
    expect(screen.getByText('10K+')).toBeInTheDocument();
    expect(screen.getByText('50+')).toBeInTheDocument();
    expect(screen.getByText('Skilled Workers')).toBeInTheDocument();
  });

  it('gives the banner artwork real alt text (not decorative)', () => {
    // The destination signpost + skyline are baked into this raster banner, so
    // they are conveyed to assistive tech via the image alt.
    render(<MobileHero locale="en" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', expect.stringMatching(/skilled workers/i));
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test-utils';
import { MobileHero } from '../MobileHero';

/**
 * The phone hero that mirrors the marketing mockup. Like the desktop hero, its
 * claims are load-bearing, so the test asserts on the promises and that the
 * imagery has real alt text — not on pixels.
 */
describe('MobileHero', () => {
  it('leads with the verified promise and the full worker-protection subline', () => {
    render(<MobileHero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/safe.*verified jobs/i);
    expect(screen.getByText(/100% verified employers/i)).toBeInTheDocument();
    // The subline states the guarantee in full — not softened to a slogan.
    expect(screen.getByText(/place to stay, health insurance, and transport/i)).toBeInTheDocument();
  });

  it('shows the three value promises', () => {
    render(<MobileHero />);
    expect(screen.getByText('Verified Employers')).toBeInTheDocument();
    expect(screen.getByText('Free for Workers')).toBeInTheDocument();
    expect(screen.getByText('India & Global Opportunities')).toBeInTheDocument();
  });

  it('gives the banner artwork real alt text (not decorative)', () => {
    // The destination signpost + skyline are baked into this raster banner, so
    // they are conveyed to assistive tech via the image alt.
    render(<MobileHero />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', expect.stringMatching(/skilled workers/i));
  });
});

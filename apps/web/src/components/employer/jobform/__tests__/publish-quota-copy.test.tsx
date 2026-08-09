import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/employer/jobs/new',
  useParams: () => ({ locale: 'en' }),
}));

import { render } from '../../../../test-utils';
import { PublishErrorHandler } from '../PublishErrorHandler';
import type { ApiError } from '../../../../lib/api/client';

/**
 * The quota message must state the SERVER's cap, never a constant.
 *
 * The Free limit is a Super-Admin setting (Screen 28). The body copy used to
 * hardcode "1 active job", so the moment an admin raised the cap the title said
 * one number and the body said another — and the employer was told a limit that
 * was not the one being enforced.
 */
function quotaError(planLimit: number): ApiError {
  return {
    code: 'JOB_QUOTA_EXCEEDED',
    status: 422,
    title: 'Unprocessable Entity',
    detail: 'Quota exceeded.',
    meta: { planLimit },
  };
}

describe('PublishErrorHandler — quota copy tracks the configured limit', () => {
  it('states the raised limit in BOTH the title and the body', () => {
    render(<PublishErrorHandler error={quotaError(5)} />);

    expect(screen.getByText(/5 jobs/i)).toBeInTheDocument();
    expect(screen.getByText(/allows 5 active jobs/i)).toBeInTheDocument();
    // The old hardcoded sentence must not survive anywhere.
    expect(screen.queryByText(/allows 1 active job at a time/i)).toBeNull();
  });

  it('still reads correctly in the singular at a limit of 1', () => {
    render(<PublishErrorHandler error={quotaError(1)} />);

    // ICU plural, so "1 job" — not the "(1 jobs)" a naive interpolation gives.
    expect(screen.getByText(/1 job\b/i)).toBeInTheDocument();
    expect(screen.getByText(/allows 1 active job\b/i)).toBeInTheDocument();
  });

  it('handles a large admin-set limit', () => {
    render(<PublishErrorHandler error={quotaError(25)} />);
    expect(screen.getByText(/allows 25 active jobs/i)).toBeInTheDocument();
  });
});

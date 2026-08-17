/**
 * The dashboard's "upload a work video" prompt.
 *
 * The rule is narrow and worth pinning: it shows until there IS a video, and
 * the only thing that silences it is a video. The failure modes are all about
 * showing it at the wrong moment —
 *
 *  - flashing in before the status arrives, then vanishing (reads as a bug),
 *  - appearing to someone who already uploaded because a request failed
 *    (tells them to do something they've done),
 *  - still being there after they upload (the prompt never pays off).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/dashboard',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../test-utils';
import { VideoIntroPrompt } from '../VideoIntroPrompt';
import * as candidateApi from '../../../lib/api/candidate';

function mockStatus(hasVideo: boolean) {
  return vi
    .spyOn(candidateApi, 'getCandidateVideo')
    .mockResolvedValue({ hasVideo, uploadedAt: null, durationSec: null, sizeBytes: null } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('VideoIntroPrompt', () => {
  it('prompts, and links to the video block on the profile page', async () => {
    mockStatus(false);
    render(<VideoIntroPrompt locale="en" />);

    expect(await screen.findByText(/upload your work video/i)).toBeInTheDocument();

    // The fragment matters: the video sits well down the profile page, and
    // dropping someone at the top is how a prompt gets ignored.
    const cta = screen.getByRole('link', { name: /add your video/i });
    expect(cta).toHaveAttribute('href', '/en/profile#video-intro');
  });

  it('stays away once a video exists', async () => {
    mockStatus(true);
    render(<VideoIntroPrompt locale="en" />);

    await waitFor(() => expect(candidateApi.getCandidateVideo).toHaveBeenCalled());
    expect(screen.queryByText(/upload your work video/i)).not.toBeInTheDocument();
  });

  it('renders nothing before the status is known', () => {
    // Never resolves — the pre-answer state.
    vi.spyOn(candidateApi, 'getCandidateVideo').mockReturnValue(new Promise(() => {}) as never);
    render(<VideoIntroPrompt locale="en" />);

    expect(screen.queryByText(/upload your work video/i)).not.toBeInTheDocument();
  });

  it('stays silent when the status cannot be fetched', async () => {
    // Unknown must not be treated as "no video" — that would nag someone who
    // already uploaded, on the strength of a failed request.
    vi.spyOn(candidateApi, 'getCandidateVideo').mockRejectedValue(new Error('offline'));
    render(<VideoIntroPrompt locale="en" />);

    await waitFor(() => expect(candidateApi.getCandidateVideo).toHaveBeenCalled());
    expect(screen.queryByText(/upload your work video/i)).not.toBeInTheDocument();
  });
});

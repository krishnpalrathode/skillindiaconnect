import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/employer/interested-candidates',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { render } from '../../../test-utils';
import { db, makeAccessToken, EMPLOYER_APPROVED_USER_ID } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import {
  markInterest,
  removeInterest,
  listInterested,
  notifyInterested,
} from '../../../lib/api/employer-interest';
import { InterestButton } from '../candidates/InterestButton';
import InterestedCandidatesPage from '../../../app/[locale]/employer/interested-candidates/page';

function loginAsEmployer() {
  const token = makeAccessToken(EMPLOYER_APPROVED_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: EMPLOYER_APPROVED_USER_ID, accessToken: token });
}

/** A candidate that exists in the mock db and is visible to employers. */
function someCandidate(): { id: string; fullName: string } {
  const first = [...db.candidates.values()].find((c) => c.profile.profileVisible !== false);
  return { id: first!.profile.id, fullName: first!.profile.fullName as string };
}
function someCandidateId(): string {
  return someCandidate().id;
}

describe('employer interest — API client (MSW)', () => {
  beforeEach(() => loginAsEmployer());
  afterEach(() => resetClient());

  it('mark is idempotent — marking twice keeps one entry', async () => {
    const id = someCandidateId();
    await markInterest(id);
    await markInterest(id);

    const res = await listInterested();
    expect(res.data.filter((c) => c.id === id)).toHaveLength(1);
    await removeInterest(id);
  });

  it('notify reports queued, and refuses to message the same candidate twice', async () => {
    const id = someCandidateId();
    await markInterest(id);

    const first = await notifyInterested([id]);
    expect(first).toEqual({ queued: 1, skipped: 0 });

    // The once-per-employer guard: a second attempt sends nothing.
    const second = await notifyInterested([id]);
    expect(second).toEqual({ queued: 0, skipped: 1 });

    const res = await listInterested();
    expect(res.data.find((c) => c.id === id)?.notifiedAt).not.toBeNull();
    await removeInterest(id);
  });

  it('un-marking removes the candidate from the list', async () => {
    const id = someCandidateId();
    await markInterest(id);
    await removeInterest(id);

    const res = await listInterested();
    expect(res.data.find((c) => c.id === id)).toBeUndefined();
  });
});

describe('InterestButton', () => {
  beforeEach(() => loginAsEmployer());
  afterEach(() => resetClient());

  it('toggles and states plainly that marking does NOT message the candidate', async () => {
    const user = userEvent.setup();
    const id = someCandidateId();
    render(<InterestButton candidateId={id} />);

    // The hint must be unambiguous — an employer should never believe that
    // shortlisting already contacted the worker.
    expect(screen.getByText(/not told/i)).toBeInTheDocument();

    const btn = screen.getByRole('button', { name: /mark as interested/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    await user.click(btn);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^interested$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await removeInterest(id);
  });

  it('says so when this candidate has already been messaged', () => {
    render(<InterestButton candidateId="x" initiallyInterested alreadyNotified />);
    expect(screen.getByText(/already messaged/i)).toBeInTheDocument();
  });
});

describe('Interested Candidates page', () => {
  beforeEach(() => loginAsEmployer());
  afterEach(() => resetClient());

  it('empty state when nothing is shortlisted', async () => {
    render(<InterestedCandidatesPage />);
    await waitFor(
      () => expect(screen.getByText(/no interested candidates yet/i)).toBeInTheDocument(),
      {
        timeout: 3000,
      },
    );
  });

  it('lists a marked candidate and notifies them, then shows Contacted', async () => {
    const user = userEvent.setup();
    const { id, fullName } = someCandidate();
    await markInterest(id);

    render(<InterestedCandidatesPage />);

    // By NAME, not /select /i — 'Select all not yet contacted' also matches that.
    const checkbox = await screen.findByRole(
      'checkbox',
      { name: new RegExp(`select ${fullName}`, 'i') },
      { timeout: 3000 },
    );
    await user.click(checkbox);

    await user.click(screen.getByRole('button', { name: /notify \(1\)/i }));

    // Exact string, not /contacted/i — the "Select all not yet contacted"
    // label contains that word too.
    await waitFor(() => expect(screen.getByText('Contacted')).toBeInTheDocument(), {
      timeout: 3000,
    });
    await removeInterest(id);
  });

  it('an already-contacted candidate cannot be selected again', async () => {
    const { id, fullName } = someCandidate();
    await markInterest(id);
    await notifyInterested([id]);

    render(<InterestedCandidatesPage />);

    const checkbox = await screen.findByRole(
      'checkbox',
      { name: new RegExp(`select ${fullName}`, 'i') },
      { timeout: 3000 },
    );
    expect(checkbox).toBeDisabled();
    await removeInterest(id);
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/en/profile',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import type { components } from '@skillindiaconnect/shared-types';
import { render } from '../../../test-utils';
import { ApplyUnlockedDialog } from '../ApplyUnlockedDialog';

type CompletionResult = components['schemas']['CompletionResult'];

/**
 * "You can now apply" — the once-only celebration.
 *
 * The whole risk in this component is WHEN it fires. Firing on the flag alone
 * greets long-eligible candidates with months-old news every time they open
 * their profile; firing on a raw percentage congratulates people who are still
 * blocked by a missing document. Both failures look like working code.
 */

function completion(over: Partial<CompletionResult> = {}): CompletionResult {
  return {
    pct: 45,
    sections: [],
    canApply: false,
    missingForApply: [],
    ...over,
  } as CompletionResult;
}

const ELIGIBLE = completion({ pct: 72, canApply: true });
const NOT_YET = completion({ pct: 45, canApply: false });

const CANDIDATE_ID = 'mock-user-candidate-apply-unlock';

async function findDialog() {
  return screen.findByRole('dialog');
}

describe('ApplyUnlockedDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockClear();
  });

  it('stays silent while the candidate is not yet eligible', async () => {
    render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays silent while completion is still loading', async () => {
    render(<ApplyUnlockedDialog completion={null} userId={CANDIDATE_ID} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('FIRES when the candidate crosses into eligibility', async () => {
    const { rerender } = render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    // Nothing yet — this is the arming render.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The save that tips them over.
    rerender(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);

    const dialog = await findDialog();
    expect(dialog).toHaveTextContent(/you can now apply for jobs/i);
    // The percentage shown is the real one, not a hardcoded threshold.
    expect(dialog).toHaveTextContent(/72%/);
  });

  it('does NOT fire for a candidate who was ALREADY eligible on arrival', async () => {
    /*
      The regression that would make this feature obnoxious: someone who became
      eligible months ago opens their profile and is congratulated again. The
      first observed value only arms the dialog — it never fires on it.
    */
    render(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('marks an already-eligible candidate as seen, so it stays quiet later too', async () => {
    // Otherwise the very next edit on that visit would look like a crossing.
    const { rerender } = render(
      <ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(
      <ApplyUnlockedDialog
        completion={completion({ pct: 80, canApply: true })}
        userId={CANDIDATE_ID}
      />,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('fires ONCE — a later crossing on the same device stays quiet', async () => {
    const { rerender, unmount } = render(
      <ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />,
    );
    rerender(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);
    await findDialog();
    unmount();

    // A fresh visit that crosses again — they have already been told.
    const second = render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    second.rerender(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends the candidate to the jobs list from the primary action', async () => {
    const { rerender } = render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    rerender(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);
    await findDialog();

    await userEvent.click(screen.getByRole('button', { name: /browse jobs/i }));

    expect(pushMock).toHaveBeenCalledWith('/en/jobs');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('can be dismissed without going anywhere', async () => {
    const { rerender } = render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    rerender(<ApplyUnlockedDialog completion={ELIGIBLE} userId={CANDIDATE_ID} />);
    await findDialog();

    await userEvent.click(screen.getByRole('button', { name: /later/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does NOT fire on percentage alone when the apply gate is still closed', async () => {
    /*
      78% but a mandatory document missing — `canApply` is false and the Apply
      button will refuse them. A popup keyed on "reached 70%" would promise an
      ability they do not have.
    */
    const blocked = completion({ pct: 78, canApply: false, missingForApply: ['Passport'] });
    const { rerender } = render(<ApplyUnlockedDialog completion={NOT_YET} userId={CANDIDATE_ID} />);
    rerender(<ApplyUnlockedDialog completion={blocked} userId={CANDIDATE_ID} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

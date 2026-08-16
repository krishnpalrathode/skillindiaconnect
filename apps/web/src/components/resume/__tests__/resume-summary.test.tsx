/**
 * The candidate-written resume intro.
 *
 * The behaviours worth defending:
 *
 *  1. Save must be EXPLICIT and must reach the server. This is the one field on
 *     the page the candidate authors rather than picks, and it is the one that
 *     prints in their own words on a document they send to employers.
 *  2. Clearing must be possible and must reach the server as a clear. Everyone
 *     starts with no summary; someone who dislikes theirs must be able to get
 *     back to none, and only an explicit request can express that.
 *  3. The cap must be enforced in the box, not discovered as a 400. The column
 *     is VARCHAR(500) and the API rejects longer — typing past it must simply
 *     stop, with a counter that says why.
 *  4. A failed save must NOT look like a success — the draft stays, so nothing
 *     the candidate typed is lost behind a green toast that was a lie.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/resume',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { ResumeSummaryCard, SUMMARY_MAX_LENGTH } from '../ResumeSummaryCard';
import * as candidateApi from '../../../lib/api/candidate';

function setup(value: string | null = null) {
  const onSaved = vi.fn();
  render(<ResumeSummaryCard value={value} onSaved={onSaved} />);
  return {
    onSaved,
    box: screen.getByRole('textbox') as HTMLTextAreaElement,
    saveButton: () => screen.getByRole('button', { name: /save/i }),
  };
}

/** Whatever the candidate sent back, echoed — the component trusts the echo. */
function echo(summary: string | null) {
  return vi.spyOn(candidateApi, 'patchCandidateProfile').mockResolvedValue({ summary } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ResumeSummaryCard', () => {
  it('saves the typed intro, trimmed, and publishes it to the preview', async () => {
    const patch = echo('Electrician with 6 years of Gulf experience.');
    const { onSaved, box, saveButton } = setup();
    const user = userEvent.setup();

    await user.type(box, '  Electrician with 6 years of Gulf experience.  ');
    await user.click(saveButton());

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({
        summary: 'Electrician with 6 years of Gulf experience.',
      }),
    );
    expect(onSaved).toHaveBeenCalledWith('Electrician with 6 years of Gulf experience.');
  });

  it('clears the summary when the box is emptied', async () => {
    const patch = echo(null);
    const { onSaved, box, saveButton } = setup('An old intro I no longer want.');
    const user = userEvent.setup();

    await user.clear(box);
    await user.click(saveButton());

    // An empty string is how a PATCH says "remove this" — the server maps it
    // to NULL, and the component reports the cleared state upward.
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ summary: '' }));
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it('does not send a request when nothing changed', async () => {
    const patch = echo('Unchanged.');
    const { saveButton } = setup('Unchanged.');
    const user = userEvent.setup();

    // Nothing edited: Save is inert rather than firing a no-op write.
    expect(saveButton()).toBeDisabled();
    await user.click(saveButton());
    expect(patch).not.toHaveBeenCalled();
  });

  it('stops typing at the cap and says so in the counter', async () => {
    echo('x');
    const { box } = setup();
    const user = userEvent.setup();

    // Paste rather than type: 500+ keystrokes is a slow test proving the same
    // thing, and paste is how a long intro actually arrives.
    await user.click(box);
    await user.paste('a'.repeat(SUMMARY_MAX_LENGTH + 50));

    expect(box.value).toHaveLength(SUMMARY_MAX_LENGTH);
    expect(screen.getByText(`${SUMMARY_MAX_LENGTH}/${SUMMARY_MAX_LENGTH}`)).toBeInTheDocument();
  });

  it('keeps the draft when the save fails', async () => {
    vi.spyOn(candidateApi, 'patchCandidateProfile').mockRejectedValue(new Error('offline'));
    const { onSaved, box, saveButton } = setup();
    const user = userEvent.setup();

    await user.type(box, 'Worth keeping.');
    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(box).toHaveValue('Worth keeping.');
    // The preview must not show an intro the server never stored.
    expect(onSaved).not.toHaveBeenCalled();
  });
});

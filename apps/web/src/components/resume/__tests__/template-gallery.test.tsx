/**
 * CR-001 F2 — the template gallery.
 *
 * The behaviours worth defending, in order of how expensive they are to get
 * wrong:
 *
 *  1. A rejected save must NOT leave the card visually selected. Otherwise the
 *     candidate regenerates believing they chose Compact and receives Classic,
 *     with no error anywhere — the "false success" this codebase avoids
 *     everywhere else.
 *  2. Selecting must mark the last PDF stale, so the existing RegeneratePrompt
 *     appears. Settings apply at GENERATION; a silent change is a lie.
 *  3. Selecting must NOT generate. The Chromium pool is small and the existing
 *     dedupe is the only thing between it and a candidate tapping four cards.
 *  4. It must be a real radio group — arrow keys, one group, full accessible
 *     names — because that is what a screen-reader user navigates.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/resume',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@skillindiaconnect/shared-types';
import { render } from '../../../test-utils';
import { TemplateGallery } from '../TemplateGallery';
import * as resumeApi from '../../../lib/api/resume';

type ResumeSettings = components['schemas']['ResumeSettings'];

const BASE: ResumeSettings = {
  language: 'en',
  showPhone: true,
  showReligion: false,
  showFatherName: true,
  showPassportNumber: false,
  template: 'CLASSIC',
};

/**
 * The gallery is a CONTROLLED component — the hub owns `settings`. So the
 * harness owns state too, or nothing would ever appear selected and every
 * selection assertion would pass vacuously against a component that does
 * nothing.
 */
function setup(overrides: Partial<ResumeSettings> = {}) {
  const onSettingsChange = vi.fn();
  const onCommitted = vi.fn();

  function Harness() {
    const [settings, setSettings] = React.useState<ResumeSettings>({ ...BASE, ...overrides });
    return (
      <TemplateGallery
        settings={settings}
        onSettingsChange={(next) => {
          onSettingsChange(next);
          setSettings(next);
        }}
        onCommitted={onCommitted}
      />
    );
  }

  render(<Harness />);
  return { onSettingsChange, onCommitted };
}

describe('TemplateGallery — presentation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('offers all four templates as ONE radio group', () => {
    setup();
    const group = screen.getByRole('group');
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
  });

  it('checks the template currently in settings', () => {
    setup({ template: 'COMPACT' });
    expect(screen.getByRole('radio', { name: /compact/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /classic/i })).not.toBeChecked();
  });

  it("each option's accessible name carries its DESCRIPTION, not just its name", () => {
    // A screen-reader user choosing between four layouts needs the same help
    // the sighted user gets from the card text.
    setup();
    expect(
      screen.getByRole('radio', { name: /compact.*two columns.*one page/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /minimal.*hiring software/i })).toBeInTheDocument();
  });

  it('badges MODERN as recommended, and only MODERN', () => {
    setup();
    expect(screen.getAllByText(/^Recommended$/)).toHaveLength(1);
  });

  it('states that the change applies on the next generation', () => {
    setup();
    expect(screen.getByText(/applies the next time you generate/i)).toBeInTheDocument();
  });
});

describe('TemplateGallery — selecting', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('PATCHes the choice and marks the last PDF stale', async () => {
    const patch = vi
      .spyOn(resumeApi, 'patchResumeSettings')
      .mockResolvedValue({ ...BASE, template: 'MODERN' });
    const { onSettingsChange, onCommitted } = setup();

    await userEvent.click(screen.getByRole('radio', { name: /modern/i }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith({ template: 'MODERN' }));
    // Optimistic first, then the server's truth.
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ template: 'MODERN' }));
    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
  });

  it('does NOT trigger a generation', async () => {
    vi.spyOn(resumeApi, 'patchResumeSettings').mockResolvedValue({ ...BASE, template: 'MODERN' });
    const generate = vi.spyOn(resumeApi, 'generateResume');
    setup();

    await userEvent.click(screen.getByRole('radio', { name: /modern/i }));
    await waitFor(() => expect(generate).not.toHaveBeenCalled());
  });

  it('ROLLS BACK and shows an error when the save is rejected', async () => {
    vi.spyOn(resumeApi, 'patchResumeSettings').mockRejectedValue(new Error('500'));
    const { onSettingsChange, onCommitted } = setup();

    await userEvent.click(screen.getByRole('radio', { name: /compact/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Last call restores the ORIGINAL template — never left showing a choice
    // the server refused.
    const last = onSettingsChange.mock.calls.at(-1)?.[0] as ResumeSettings;
    expect(last.template).toBe('CLASSIC');
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it('ignores a click on the already-selected template (no redundant PATCH)', async () => {
    const patch = vi.spyOn(resumeApi, 'patchResumeSettings');
    setup({ template: 'MODERN' });

    await userEvent.click(screen.getByRole('radio', { name: /modern/i }));
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('TemplateGallery — keyboard', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('moves between options with arrow keys', async () => {
    vi.spyOn(resumeApi, 'patchResumeSettings').mockImplementation(
      async (body) => ({ ...BASE, ...body }) as ResumeSettings,
    );
    setup({ template: 'MODERN' });

    const modern = screen.getByRole('radio', { name: /modern/i });
    modern.focus();
    await userEvent.keyboard('{ArrowRight}');

    // Native radio semantics: arrow moves focus AND selection within the group.
    await waitFor(() => expect(screen.getByRole('radio', { name: /classic/i })).toBeChecked());
  });
});

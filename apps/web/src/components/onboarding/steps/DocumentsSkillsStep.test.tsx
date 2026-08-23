import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@skillindiaconnect/shared-types';
import { render } from '../../../test-utils';
import { DocumentsSkillsStep } from './DocumentsSkillsStep';
import * as candidateApi from '../../../lib/api/candidate';

/**
 * Onboarding step 3 — what must hold about NOTICE PERIOD.
 *
 * The field was mandatory here and nowhere else: nullable in the schema,
 * `@IsOptional()` in the DTO, and deliberately excluded from the completion
 * score. This screen was the only thing enforcing it, and it blocked exactly
 * the candidates least able to answer — between jobs, or in daily-wage work,
 * where the only way forward was to invent a number.
 */

type CandidateProfile = components['schemas']['CandidateProfile'];

const PROFILE = {
  id: 'cand-1',
  fullName: 'Suresh Kumar',
  currentLocation: null,
  nationality: null,
  noticePeriod: null,
  documents: [],
  skills: [],
} as unknown as CandidateProfile;

function setup(profile: CandidateProfile = PROFILE) {
  const onNext = vi.fn();
  render(
    <DocumentsSkillsStep
      profile={profile}
      onProfileUpdate={vi.fn()}
      onNext={onNext}
      onBack={vi.fn()}
    />,
  );
  return { onNext };
}

/** The two genuinely required fields, so the step is otherwise satisfiable. */
async function fillRequiredFields() {
  await userEvent.type(screen.getByPlaceholderText(/city, state or country/i), 'Gorakhpur');
  await userEvent.type(screen.getByPlaceholderText(/e\.g\. indian/i), 'Indian');
}

describe('DocumentsSkillsStep — notice period is optional', () => {
  let patchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    patchSpy = vi
      .spyOn(candidateApi, 'patchCandidateProfile')
      .mockResolvedValue(PROFILE as never) as never;
  });

  it('ADVANCES with notice period left blank', async () => {
    const { onNext } = setup();
    await fillRequiredFields();

    const next = screen.getByRole('button', { name: /next|continue/i });
    expect(next).toBeEnabled();

    await userEvent.click(next);
    await waitFor(() => expect(onNext).toHaveBeenCalled());
  });

  it('OMITS notice period from the patch when blank — never sends 0', async () => {
    /*
      The trap this exists for: `Number('')` is 0, so the obvious implementation
      records "0 days notice — available immediately" for everyone who skipped
      the field. That is a specific claim about the candidate's availability
      that they never made, and employers read it as fact.
    */
    setup();
    await fillRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: /next|continue/i }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalled());

    const patch = patchSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('noticePeriod');
    expect(patch).toMatchObject({ currentLocation: 'Gorakhpur', nationality: 'Indian' });
  });

  it('still SENDS notice period, as a number, when the candidate fills it in', async () => {
    // Optional must not mean ignored — a candidate who states 30 days has that
    // recorded and shown to employers.
    setup();
    await fillRequiredFields();
    await userEvent.type(screen.getByPlaceholderText('30'), '45');
    await userEvent.click(screen.getByRole('button', { name: /next|continue/i }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    expect(patchSpy.mock.calls[0]![0]).toMatchObject({ noticePeriod: 45 });
  });

  it('does not mark the notice period field as required', async () => {
    // The asterisk is the promise the form makes to the user; leaving it while
    // the field no longer blocks would be the form lying about its own rules.
    setup();
    const notice = screen.getByPlaceholderText('30');
    expect(notice).not.toBeRequired();
    expect(notice.getAttribute('aria-required')).not.toBe('true');
  });

  it('KEEPS location and nationality blocking — this change is scoped to notice period', async () => {
    const { onNext } = setup();

    expect(screen.getByRole('button', { name: /next|continue/i })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/city, state or country/i), 'Gorakhpur');
    expect(screen.getByRole('button', { name: /next|continue/i })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. indian/i), 'Indian');
    expect(screen.getByRole('button', { name: /next|continue/i })).toBeEnabled();

    expect(onNext).not.toHaveBeenCalled();
  });
});

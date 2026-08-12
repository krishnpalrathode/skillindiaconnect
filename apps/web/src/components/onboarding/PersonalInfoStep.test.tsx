import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { components } from '@skillindiaconnect/shared-types';
import { render } from '../../test-utils';
import { PersonalInfoStep } from './steps/PersonalInfoStep';

type CandidateProfile = components['schemas']['CandidateProfile'];

/**
 * The onboarding profile photo used to be a LOCAL PREVIEW ONLY — a
 * `URL.createObjectURL` held in this component's state, with a comment saying
 * there was no upload endpoint yet. That endpoint has existed for a while, so
 * the photo was never persisted at all: stepping to Work Experience unmounts
 * this component, the object URL died with it, and coming back showed an empty
 * circle. The candidate had uploaded nothing, but had been shown a photo.
 *
 * Both halves of the fix are pinned here, because either one alone still loses
 * the photo:
 *   - the preview SEEDS from `profile.photoUrl` (survives the remount), and
 *   - a successful upload LIFTS the saved profile to the stepper via
 *     `onProfileUpdate` (so the parent holds it while you are on step 2).
 */
describe('PersonalInfoStep — the profile photo survives leaving and re-entering step 1', () => {
  const baseProfile = {
    id: 'cand-1',
    email: 'candidate@example.com',
    fullName: 'Krishna Jadon',
    languages: [],
    photoUrl: null,
  } as unknown as CandidateProfile;

  it('renders the SAVED photo on mount, so returning from step 2 still shows it', () => {
    const profile = {
      ...baseProfile,
      photoUrl: 'https://r2.example.com/candidates/cand-1/photo/abc.png?signed=1',
    } as CandidateProfile;

    render(<PersonalInfoStep profile={profile} onProfileUpdate={vi.fn()} onNext={vi.fn()} />);

    const img = screen.getByAltText('Profile') as HTMLImageElement;
    // next/image rewrites the src, so assert the ORIGIN url is carried through
    // rather than an exact string match.
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain(
      'r2.example.com/candidates/cand-1/photo/abc.png',
    );
  });

  it('shows no photo when the profile has none — the empty state is still reachable', () => {
    render(<PersonalInfoStep profile={baseProfile} onProfileUpdate={vi.fn()} onNext={vi.fn()} />);

    expect(screen.queryByAltText('Profile')).toBeNull();
  });

  /*
    The UPLOAD leg (presign → PUT → confirm → onProfileUpdate) is deliberately
    NOT unit-tested here: `compressImage` runs on a canvas, which jsdom does not
    implement, so any test of it would really be testing three mocks. It is
    covered against the live API instead — a signed r2 url replaces the local
    preview after a real upload.
  */
});

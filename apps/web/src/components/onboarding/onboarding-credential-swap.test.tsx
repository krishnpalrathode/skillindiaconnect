import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import type { components } from '@skillindiaconnect/shared-types';
import { setAccessToken } from '@/lib/api/client';
import { db, makeAccessToken } from '@/mocks/data';
import { PersonalInfoStep } from './steps/PersonalInfoStep';

type CandidateProfile = components['schemas']['CandidateProfile'];

const USER_ID = 'mock-user-candidate-1';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/*
  Email verification and set-password are AUTHENTICATED endpoints — the caller
  is taken from the token, never the body. Without a token the mock answers 401
  and the flow never leaves the first stage, so the token is the setup that
  makes these tests exercise the real path rather than an error branch.
*/
beforeEach(() => {
  // The mock resolves a caller by looking the token up in db.sessions, so a
  // minted token alone is not a session — it has to be registered too.
  const token = makeAccessToken(USER_ID);
  db.sessions.set(token, { userId: USER_ID, accessToken: token });
  setAccessToken(token);
});

const base = {
  id: USER_ID,
  role: 'CANDIDATE' as const,
  fullName: 'Ramesh Kumar',
  dob: '1995-04-12',
  completionPct: 20,
  profileVisible: true,
  isAvailable: true,
  experiences: [],
  skills: [],
  documents: [],
  status: 'ACTIVE' as const,
  createdAt: new Date().toISOString(),
};

/** Signed up with an address: has email + password, owes a verified phone. */
const emailSignup = {
  ...base,
  email: 'ramesh@example.com',
  emailVerifiedAt: new Date().toISOString(),
  hasPassword: true,
  hasGoogle: false,
  phone: undefined,
  phoneVerifiedAt: null,
} as unknown as CandidateProfile;

/** Signed up with a number: phone already verified, owes email + password. */
const phoneSignup = {
  ...base,
  email: null,
  emailVerifiedAt: null,
  hasPassword: false,
  hasGoogle: false,
  phone: '+919876543210',
  phoneVerifiedAt: new Date().toISOString(),
} as unknown as CandidateProfile;

function renderStep(profile: CandidateProfile) {
  const onProfileUpdate = vi.fn();
  const onNext = vi.fn();
  render(<PersonalInfoStep profile={profile} onProfileUpdate={onProfileUpdate} onNext={onNext} />);
  return { onProfileUpdate, onNext };
}

describe('Onboarding asks for whichever credential the account lacks', () => {
  /**
   * The guarantee for the existing user base: an email signup's onboarding is
   * untouched by any of this.
   */
  it('an email signup still verifies their phone, and is asked for nothing else', () => {
    renderStep(emailSignup);
    expect(screen.getByText(/verify your (phone|mobile)/i)).toBeInTheDocument();
    expect(screen.queryByText(/verify your email/i)).toBeNull();
    expect(screen.queryByText(/set a password/i)).toBeNull();
  });

  /**
   * The swap. Their number was verified to create the account, so re-asking
   * for it would be asking for the one thing they have already proved.
   */
  it('a phone signup verifies their email instead, and is not re-asked for the phone', () => {
    renderStep(phoneSignup);
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(screen.queryByText(/verify your (phone|mobile)/i)).toBeNull();
  });

  /**
   * Decision 2, in order. Showing both at once would let someone set a
   * password on an account we cannot yet reach if they forget it.
   */
  it('withholds the password step until the address is proven', () => {
    renderStep(phoneSignup);
    expect(screen.queryByText(/set a password/i)).toBeNull();
  });

  it('asks for the password once the address is verified', async () => {
    const user = userEvent.setup();
    renderStep(phoneSignup);

    await user.type(screen.getByLabelText(/email address/i), 'ramesh.new@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    // By its own aria-label — the step also renders name and languages inputs,
    // so an index into every textbox on the page would be fragile.
    await user.type(await screen.findByLabelText(/OTP digit 1 of/i), '123456');

    await waitFor(() => expect(screen.getByText(/set a password/i)).toBeInTheDocument());
  });

  /**
   * A Google account has no password hash either. Keying the step off
   * `!hasPassword` alone would invent a step for someone who already has a
   * durable way in.
   */
  it('never demands a password from a Google account', () => {
    renderStep({
      ...emailSignup,
      hasPassword: false,
      hasGoogle: true,
    } as unknown as CandidateProfile);

    expect(screen.queryByText(/set a password/i)).toBeNull();
    expect(screen.getByText(/verify your (phone|mobile)/i)).toBeInTheDocument();
  });

  /**
   * Reload safety, and the bug this caught.
   *
   * The password step used to be nested inside the email branch. Once the
   * address was saved `needsEmail` went false, so on the next load the whole
   * branch vanished — password step included — and a candidate who had verified
   * their email but never set a password was waved straight through with a
   * WhatsApp code to one number as their only way back in.
   *
   * The three blocks are independent conditions now, and this is the case that
   * distinguishes the two designs.
   */
  it('still owes the password after a reload, and cannot advance without it', () => {
    renderStep({
      ...phoneSignup,
      email: 'ramesh@example.com',
      emailVerifiedAt: new Date().toISOString(),
      hasPassword: false,
    } as unknown as CandidateProfile);

    // Neither credential is re-asked — both are already proven.
    expect(screen.queryByText(/verify your email/i)).toBeNull();
    expect(screen.queryByText(/verify your (phone|mobile)/i)).toBeNull();

    // But the password is still owed, and still blocks the step.
    expect(screen.getByText(/set a password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue|next/i })).toBeDisabled();
  });
});

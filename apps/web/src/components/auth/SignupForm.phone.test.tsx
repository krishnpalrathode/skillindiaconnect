import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { SignupForm } from './SignupForm';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const MOCK_OTP = '123456';
const FIELD = /email address or mobile number/i;

/** A number nobody has signed up with yet — the mock db keys on the E.164 form. */
const freshNumber = () => `98${String(Date.now()).slice(-8)}`;

async function typeIdentifier(value: string) {
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  render(<SignupForm onSuccess={onSuccess} />);
  await user.type(screen.getByLabelText(FIELD), value);
  return { user, onSuccess };
}

describe('SignupForm — one field, two credentials', () => {
  /**
   * The whole premise of the single field: what the user types decides what
   * the rest of the form asks for. Neither of these is a mode the user picked.
   */
  it('asks for a password once the field looks like an email address', async () => {
    await typeIdentifier('someone@example.com');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send otp/i })).toBeNull();
  });

  it('offers an OTP — not a password — once the field looks like a number', async () => {
    await typeIdentifier(freshNumber());
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: /send otp/i })).toBeInTheDocument();
  });

  it('shows neither while the field is still ambiguous', async () => {
    await typeIdentifier('98');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  /**
   * A numeric local part is the case that would break a naive "starts with a
   * digit" check — and it is a real address shape, not a contrived one.
   */
  it('treats a numeric email address as an address', async () => {
    await typeIdentifier('9876543210@gmail.com');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});

describe('SignupForm — phone signup', () => {
  it('creates the account after the code is verified', async () => {
    const { user, onSuccess } = await typeIdentifier(freshNumber());

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    // The form is replaced by the code panel.
    const boxes = await screen.findAllByRole('textbox');
    expect(boxes.length).toBeGreaterThanOrEqual(6);

    await user.type(boxes[0]!, MOCK_OTP);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('CANDIDATE'));
  });

  it('will not send a code until the terms are accepted', async () => {
    await typeIdentifier(freshNumber());
    expect(screen.getByRole('button', { name: /send otp/i })).toBeDisabled();
  });

  /**
   * The failure that matters most: a number that already has an account must
   * NOT advance to the code screen. Waiting for a code that was never sent is
   * the dead end this branch exists to prevent.
   */
  it('keeps the user on the form when the number is already registered', async () => {
    const { user } = await typeIdentifier('9555555555');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already registered/i));
    // Still on the form, with the button available to retry.
    expect(screen.getByRole('button', { name: /send otp/i })).toBeInTheDocument();
  });

  it('says so when the number cannot receive WhatsApp, instead of advancing', async () => {
    // NOT_ON_WHATSAPP_PHONE in the mock db, as +91 9999999999.
    const { user } = await typeIdentifier('9999999999');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not on whatsapp/i));
    expect(screen.getByRole('button', { name: /send otp/i })).toBeInTheDocument();
  });

  /**
   * Phone signup is candidates only — the API has no employer route. An
   * employer who types a number gets the reason rather than a button that
   * silently does nothing.
   */
  it('explains that employers need a work email', async () => {
    const { user } = await typeIdentifier(freshNumber());
    await user.click(screen.getByRole('radio', { name: /employer/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/work email/i);
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { PhoneLoginFlow } from './PhoneLoginFlow';
import { MOCK_OTP } from '../../mocks/data';

describe('PhoneLoginFlow — enumeration safety', () => {
  it('always advances to OTP step regardless of whether phone is registered', async () => {
    const user = userEvent.setup();
    render(<PhoneLoginFlow onSuccess={vi.fn()} onUseAnotherMethod={vi.fn()} />);

    // Any number — even one NOT pre-seeded in verifiedPhones
    const phoneField = screen.getByLabelText(/phone number/i);
    await user.type(phoneField, '1111111111');
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    // UI must always advance — no error revealing account existence
    await waitFor(() => expect(screen.getByText(/6-digit code/i)).toBeInTheDocument());
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
  });
});

describe('PhoneLoginFlow — OTP verification', () => {
  const SEEDED_PHONE = '9876543210'; // maps to +919876543210 via +91 prefix

  async function advanceToOtp() {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<PhoneLoginFlow onSuccess={onSuccess} onUseAnotherMethod={vi.fn()} />);

    await user.type(screen.getByLabelText(/phone number/i), SEEDED_PHONE);
    await user.click(screen.getByRole('button', { name: /send otp/i }));
    await waitFor(() => screen.getByText(/6-digit code/i));
    return { user, onSuccess };
  }

  it('calls onSuccess after entering the correct OTP', async () => {
    const { onSuccess } = await advanceToOtp();
    const cells = screen.getAllByRole('textbox') as HTMLInputElement[];

    // Paste the mock OTP
    fireEvent.paste(cells[0]!, {
      clipboardData: { getData: () => MOCK_OTP },
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows error for wrong OTP without calling onSuccess', async () => {
    const { onSuccess } = await advanceToOtp();
    const cells = screen.getAllByRole('textbox') as HTMLInputElement[];

    fireEvent.paste(cells[0]!, {
      clipboardData: { getData: () => '000000' },
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired/i));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('allows going back to the phone step', async () => {
    await advanceToOtp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /wrong number/i }));
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
  });
});

/**
 * CR-WA W1.6 — the escape hatch for a WhatsApp OTP that never arrives.
 *
 * `/auth/login/phone/start` deliberately swallows the send outcome: a send is
 * only ATTEMPTED for a registered number, so surfacing the honest
 * OTP_SEND_FAILED here would tell an attacker that a failure implies an
 * account. The client therefore CANNOT know the send failed.
 *
 * The resolution is to stop reacting to a failure it cannot see and offer the
 * alternative to everyone, always. An affordance present for every caller
 * discriminates between none of them.
 *
 * The copy is METHOD-NEUTRAL because `users.passwordHash` is nullable: a
 * Google-signup candidate with a verified phone has no password, so "continue
 * with email" would have pointed them at a form they cannot use. Switching away
 * from the phone panel reveals both the email form and the Google button.
 */
describe('PhoneLoginFlow — the sign-in escape hatch (CR-WA W1.6)', () => {
  const methodLink = () => screen.queryByRole('button', { name: /use another sign-in method/i });

  it('is present on the phone step before any request is made', () => {
    render(<PhoneLoginFlow onSuccess={vi.fn()} onUseAnotherMethod={vi.fn()} />);
    // Rendered from first paint — nothing derived from a response gates it.
    expect(methodLink()).toBeInTheDocument();
  });

  it('is present on the OTP step — the screen where the lockout actually bites', async () => {
    const user = userEvent.setup();
    render(<PhoneLoginFlow onSuccess={vi.fn()} onUseAnotherMethod={vi.fn()} />);

    await user.type(screen.getByLabelText(/phone number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /send otp/i }));
    await waitFor(() => screen.getByText(/6-digit code/i));

    // Without this the outage path is a dead end: the user watches an empty OTP
    // field for a code that was never dispatched, with no way forward.
    expect(methodLink()).toBeInTheDocument();
  });

  it('asks the caller to switch away from the phone method', async () => {
    const user = userEvent.setup();
    const onUseAnotherMethod = vi.fn();
    render(<PhoneLoginFlow onSuccess={vi.fn()} onUseAnotherMethod={onUseAnotherMethod} />);

    await user.click(methodLink()!);
    expect(onUseAnotherMethod).toHaveBeenCalledTimes(1);
  });

  /**
   * THE ORACLE TEST — the client-side mirror of the API's
   * `new Set(bodies).size === 1` assertion.
   *
   * Comparing the entire rendered text, not just the affordance, is what makes
   * this a real guarantee: it fails on ANY divergence between a registered and
   * an unregistered number, including one a future change introduces somewhere
   * this test never names.
   *
   * Digits are normalised away because the screen legitimately echoes back the
   * number the USER typed (masked). That is not a leak — it is their own input,
   * never a server-returned value.
   */
  it('ORACLE: renders identically for a registered and an unregistered number', async () => {
    const normalise = (text: string) => text.replace(/\d/g, '#').replace(/\s+/g, ' ').trim();

    async function renderThrough(phone: string): Promise<string> {
      const user = userEvent.setup();
      const view = render(<PhoneLoginFlow onSuccess={vi.fn()} onUseAnotherMethod={vi.fn()} />);
      await user.type(screen.getByLabelText(/phone number/i), phone);
      await user.click(screen.getByRole('button', { name: /send otp/i }));
      await waitFor(() => screen.getByText(/6-digit code/i));
      const text = normalise(view.container.textContent ?? '');
      view.unmount();
      return text;
    }

    const registered = await renderThrough('9876543210'); // seeded in verifiedPhones
    const unregistered = await renderThrough('1111111111'); // no account

    expect(unregistered).toBe(registered);
  });
});

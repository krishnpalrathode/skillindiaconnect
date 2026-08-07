import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { PhoneVerify } from './PhoneVerify';

/**
 * CR-WA W1.6 — the UI half of W1.5.
 *
 * W1.5 stopped the API reporting a failed OTP send as a success. That fix is
 * worth nothing while the client renders the honest 503 as "code sent", which
 * is exactly what this screen used to do: its catch-all branch displayed
 * t('otpSent') — "Enter the 6-digit code sent to your number" — as the error.
 *
 * `/auth/otp/send` is the ONLY endpoint that surfaces OTP_SEND_FAILED. Its
 * sibling `/auth/login/phone/start` deliberately stays silent to avoid becoming
 * an account-existence oracle (see PhoneLoginFlow.test.tsx), so this screen is
 * the only place the honest code can be acted on.
 */
describe('PhoneVerify — honest send failures (CR-WA W1.6)', () => {
  /** Maps to OTP_SEND_FAILS_PHONE (+919888888888) through toE164. */
  const OUTAGE_NUMBER = '9888888888';
  /** Maps to NOT_ON_WHATSAPP_PHONE (+919999999999). */
  const NOT_ON_WHATSAPP_NUMBER = '9999999999';
  const WORKING_NUMBER = '9876543210';

  async function submit(number: string) {
    const user = userEvent.setup();
    render(<PhoneVerify onVerified={vi.fn()} />);
    await user.type(screen.getByLabelText(/mobile number/i), number);
    await user.click(screen.getByRole('button', { name: /verify phone/i }));
    return user;
  }

  it('a provider outage says so — and never claims the code was sent', async () => {
    await submit(OUTAGE_NUMBER);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't send your code right now/i),
    );

    /**
     * THE REGRESSION THIS FILE EXISTS FOR. The old fallback rendered the
     * "sent" copy as the error, so a user whose code was never dispatched was
     * told to go and enter it. Asserting the failure message alone would still
     * pass if that string came back alongside it.
     */
    expect(screen.queryByText(/6-digit code sent to your number/i)).not.toBeInTheDocument();
  });

  it('a failed send does not advance to OTP entry — there is no code to type', async () => {
    await submit(OUTAGE_NUMBER);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // The phone field is still on screen, so retrying costs one tap.
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
  });

  it('an already-registered NUMBER is rejected before OTP entry, with its own message', async () => {
    // Maps to +919555555555 → 409 PHONE_ALREADY_IN_USE from the send endpoint.
    await submit('9555555555');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/already registered/i),
    );
    // Rejected BEFORE the OTP step — no code to type.
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
  });

  it('an unreachable NUMBER is a different message from a provider outage', async () => {
    await submit(NOT_ON_WHATSAPP_NUMBER);

    /**
     * The two failures need different user actions: this one means "use another
     * number", the outage means "try again shortly". Collapsing them into one
     * generic error would send people hunting for a second SIM during an
     * outage — which is why the component branches on the CODE rather than
     * treating every rejection alike.
     */
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not on WhatsApp/i));
    expect(screen.queryByText(/couldn't send your code/i)).not.toBeInTheDocument();
  });

  /**
   * THE 429 SEEN IN PRODUCTION.
   *
   * This screen had no rate-limit branch, so a 429 fell through to the generic
   * "Something went wrong. Please try again." — telling the user to do the one
   * thing guaranteed to keep failing, and (because every attempt increments the
   * counter) to keep the window open longer.
   *
   * The branch matches on STATUS, not code: the API emits OTP_RATE_LIMITED from
   * OtpService's budgets but RATE_LIMITED from ThrottlerGuard, and matching one
   * string silently misses the other.
   */
  it('a 429 says WAIT — not "try again"', async () => {
    await submit('9777777777'); // → OTP_RATE_LIMITED_PHONE

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i));
    expect(screen.getByRole('alert')).toHaveTextContent(/wait/i);
    // The generic copy would have invited an immediate retry.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('a successful send still advances to OTP entry', async () => {
    await submit(WORKING_NUMBER);

    await waitFor(() =>
      expect(screen.getByText(/6-digit code sent to your number/i)).toBeInTheDocument(),
    );
    // The success copy is NOT an alert — it is guidance, not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

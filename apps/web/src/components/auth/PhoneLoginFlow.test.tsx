import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { PhoneLoginFlow } from './PhoneLoginFlow';
import { MOCK_OTP } from '../../mocks/data';

describe('PhoneLoginFlow — enumeration safety', () => {
  it('always advances to OTP step regardless of whether phone is registered', async () => {
    const user = userEvent.setup();
    render(<PhoneLoginFlow onSuccess={vi.fn()} />);

    // Any number — even one NOT pre-seeded in verifiedPhones
    const phoneField = screen.getByLabelText(/phone number/i);
    await user.type(phoneField, '1111111111');
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    // UI must always advance — no error revealing account existence
    await waitFor(() =>
      expect(screen.getByText(/6-digit code/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
  });
});

describe('PhoneLoginFlow — OTP verification', () => {
  const SEEDED_PHONE = '9876543210'; // maps to +919876543210 via +91 prefix

  async function advanceToOtp() {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<PhoneLoginFlow onSuccess={onSuccess} />);

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

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired/i),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('allows going back to the phone step', async () => {
    await advanceToOtp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /wrong number/i }));
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
  });
});

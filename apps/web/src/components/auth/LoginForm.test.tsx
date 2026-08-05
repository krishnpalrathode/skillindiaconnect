import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('submits valid credentials and calls onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/email address/i), 'amir@example.com');
    await user.type(screen.getByLabelText('Password'), 'any-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows invalid credentials error for unknown email', async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText(/email address/i), 'nobody@nowhere.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/incorrect email or password/i),
    );
  });

  it('falls back to a link to /forgot-password when no handler is supplied', () => {
    render(<LoginForm onSuccess={vi.fn()} />);
    expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('renders a BUTTON (not a link) when the host can swap the panel in place', async () => {
    const user = userEvent.setup();
    const onForgotPassword = vi.fn();
    render(<LoginForm onSuccess={vi.fn()} onForgotPassword={onForgotPassword} />);

    // No link means no navigation — the host handles it on the same page.
    expect(screen.queryByRole('link', { name: /forgot password/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
  });
});

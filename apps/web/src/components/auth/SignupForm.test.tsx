import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils';
import { SignupForm } from './SignupForm';

// SignupForm reads ?role= to preselect the role card, so the suite needs a
// controllable search-params stub.
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
});

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  render(<SignupForm onSuccess={onSuccess} />);

  await user.type(screen.getByLabelText(/email address/i), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: /create account/i }));

  return { user, onSuccess };
}

describe('SignupForm', () => {
  it('renders CANDIDATE role selected by default', () => {
    render(<SignupForm onSuccess={vi.fn()} />);
    const jobSeekerBtn = screen.getByRole('radio', { name: /job seeker/i });
    expect(jobSeekerBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('creates account with new email and calls onSuccess', async () => {
    const { onSuccess } = await fillAndSubmit(`new-${Date.now()}@example.com`, 'StrongP@ss1');
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('CANDIDATE'));
  });

  it('shows EMAIL_TAKEN error when email is already registered', async () => {
    // amir@example.com is pre-seeded in the mock db
    await fillAndSubmit('amir@example.com', 'AnyP@ssw0rd');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /account with this email already exists/i,
      ),
    );
  });

  it('blocks submission until terms are accepted', async () => {
    const user = userEvent.setup();
    render(<SignupForm onSuccess={vi.fn()} />);

    const btn = screen.getByRole('button', { name: /create account/i });
    expect(btn).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(btn).not.toBeDisabled();
  });

  it('switches role to EMPLOYER when toggled', async () => {
    const user = userEvent.setup();
    render(<SignupForm onSuccess={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /employer/i }));
    expect(screen.getByRole('radio', { name: /employer/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /job seeker/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  // ── ?role= deep-link preselection ─────────────────────────────────────────
  describe('role query parameter', () => {
    it('preselects EMPLOYER when ?role=employer is present', () => {
      mockSearchParams = new URLSearchParams('role=employer');
      render(<SignupForm onSuccess={vi.fn()} />);

      expect(screen.getByRole('radio', { name: /employer/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('radio', { name: /job seeker/i })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('defaults to CANDIDATE when the param is absent', () => {
      render(<SignupForm onSuccess={vi.fn()} />);

      expect(screen.getByRole('radio', { name: /job seeker/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('radio', { name: /employer/i })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('ignores an unrecognised role value and defaults to CANDIDATE', () => {
      mockSearchParams = new URLSearchParams('role=banana');
      render(<SignupForm onSuccess={vi.fn()} />);

      expect(screen.getByRole('radio', { name: /job seeker/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('submits EMPLOYER when the form is deep-linked with ?role=employer', async () => {
      mockSearchParams = new URLSearchParams('role=employer');
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(<SignupForm onSuccess={onSuccess} />);

      await user.type(screen.getByLabelText(/email address/i), `emp-${Date.now()}@example.com`);
      await user.type(screen.getByLabelText('Password'), 'StrongP@ss1');
      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('EMPLOYER'));
    });
  });
});

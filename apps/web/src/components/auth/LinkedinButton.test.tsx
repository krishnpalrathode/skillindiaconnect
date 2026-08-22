import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { render } from '../../test-utils';
import { LinkedinButton } from './LinkedinButton';
import { OAuthErrorNotice } from './OAuthErrorNotice';

/**
 * The two halves of LinkedIn sign-in that live in the browser: starting the
 * flow, and explaining it when it fails.
 *
 * The handshake itself cannot be tested here — it needs linkedin.com and a real
 * consent screen — so what is worth pinning is everything AROUND it, which is
 * where the browser-side mistakes actually are.
 */

describe('LinkedinButton', () => {
  const original = window.location;

  beforeEach(() => {
    // jsdom refuses assignment to window.location, and a full navigation is
    // precisely the behaviour under test, so it is replaced with a recorder.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('performs a TOP-LEVEL navigation to the LinkedIn auth endpoint', async () => {
    /*
      A fetch() here would be the natural-looking mistake and a broken one: the
      endpoint answers with a cross-origin redirect to LinkedIn's consent screen,
      which XHR cannot follow, and the API sets an HttpOnly cookie on the way
      back that only a real navigation carries.
    */
    render(<LinkedinButton label="Continue with LinkedIn" />);

    await userEvent.click(screen.getByRole('button', { name: /continue with linkedin/i }));

    expect(window.location.href).toContain('/api/v1/auth/linkedin');
  });

  it('renders its label and keeps the brand mark out of the accessible name', () => {
    render(<LinkedinButton label="Sign up with LinkedIn" />);

    // The glyph is decorative; the label already says LinkedIn. Announcing the
    // icon too would read the provider twice.
    const button = screen.getByRole('button', { name: 'Sign up with LinkedIn' });
    expect(button).toBeInTheDocument();
  });
});

describe('OAuthErrorNotice', () => {
  it('renders nothing when there is no error', () => {
    // Asserted as "no alert", not "empty container": the shared render helper
    // wraps everything in ToastProvider, which mounts its own live regions, so
    // an emptiness check would be testing the harness rather than this component.
    render(<OAuthErrorNotice code={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a known failure code in the user’s language', () => {
    render(<OAuthErrorNotice code="LINKEDIN_NO_EMAIL" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/didn't share an email address/i);
  });

  it('announces itself — the user was REDIRECTED here, nothing else tells them', () => {
    render(<OAuthErrorNotice code="LINKEDIN_FAILED" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('falls back to a generic message for an UNKNOWN code, rather than a raw key', () => {
    /*
      `code` is raw URL input. Interpolating it into a translation key would let
      anyone craft a link that renders an arbitrary catalogue string on our login
      page — a phishing lure wearing our own styling. An unknown code must
      degrade, and must never echo itself back into the page.
    */
    render(<OAuthErrorNotice code="ACCOUNT_CLOSED_CALL_1800_SCAM" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/didn't work/i);
    expect(alert).not.toHaveTextContent(/1800/);
  });
});

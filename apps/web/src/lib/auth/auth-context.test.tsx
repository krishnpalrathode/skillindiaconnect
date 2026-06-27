import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';
import { resetClient } from '../api/client';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../i18n/messages/en.json';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthProvider>{children}</AuthProvider>
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  resetClient();
});

describe('AuthProvider bootstrap', () => {
  it('starts with isLoading=true then resolves to user=null (no refresh cookie)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
  });
});

describe('login()', () => {
  it('sets user and clears loading after successful login', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login('amir@example.com', 'any-password');
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.email).toBe('amir@example.com');
    expect(result.current.user?.role).toBe('CANDIDATE');
  });
});

describe('logout()', () => {
  it('clears user after logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login('amir@example.com', 'any-password');
    });
    expect(result.current.user).not.toBeNull();

    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
  });
});

// IMPORTANT: this test must remain last in the file.
// act().rejects.toThrow() leaves React's fiber tree in an error state that
// prevents the next renderHook() in the same file from initialising.  Keeping
// the "throws" case last means there is no subsequent test to be affected.
describe('login() errors', () => {
  it('throws ApiRequestError on invalid credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.login('nobody@nowhere.com', 'wrong');
      }),
    ).rejects.toThrow();
    expect(result.current.user).toBeNull();
  });
});

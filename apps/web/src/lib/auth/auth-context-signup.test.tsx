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

describe('signup()', () => {
  it('creates a user and sets them as authenticated', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signup({
        email: 'newuser@example.com',
        password: 'StrongP@ss1',
        role: 'CANDIDATE',
        acceptedTerms: true,
      });
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.email).toBe('newuser@example.com');
  });
});

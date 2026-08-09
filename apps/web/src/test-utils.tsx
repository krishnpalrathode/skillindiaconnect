import React from 'react';

//import { render, type RenderOptions } from '@testing-library/react';
//kp code start
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
//kp code end
import { NextIntlClientProvider } from 'next-intl';
import { AuthProvider } from './lib/auth/auth-context';
import { ToastProvider } from './components/ui/toast';
import enMessages from './i18n/messages/en.json';

// ToastProvider sits here because success toasts are now fired from shared
// pieces (EditableSection, FileUpload, ApplySheet…), so almost any component
// under test can reach for useToast. It needs nothing but the intl messages
// already above it — unlike LogoutConfirmProvider, which requires a mocked
// next/navigation and therefore stays opt-in per suite.
function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

// function customRender(ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
//   return render(ui, { wrapper: AllProviders, ...options });
// }

//kp code start
function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, { wrapper: AllProviders, ...options });
}
//kp code end
export * from '@testing-library/react';
export { customRender as render };

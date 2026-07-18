import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../i18n/messages/en.json';
import { server } from '../../../mocks/server';
import { http, HttpResponse } from 'msw';
import {
  db,
  makeAccessToken,
  EMPLOYER_APPROVED_USER_ID,
  EMPLOYER_PENDING_USER_ID,
} from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { EmployerProvider } from '../../../lib/employer/employer-context';
import { CompanyStateBanner } from '../CompanyStateBanner';
import { EmployerSidebar } from '../EmployerSidebar';
import { PlanStatusWidget } from '../PlanStatusWidget';
import { EMPLOYER_PRO_USER_ID, EMPLOYER_GRACE_USER_ID } from '../../../mocks/data';

// ─── Mock next navigation ─────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/employer/dashboard',
  useParams: () => ({ locale: 'en' }),
}));

// PlanStatusWidget now uses getSubscriptionStatus (billing.ts → MSW /billing/subscription).
// No module mock needed — the MSW handler is already live.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthProvider>
        <EmployerProvider>{children}</EmployerProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

function loginAsEmployer(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}

beforeEach(() => {
  resetClient();
});

// ─── CompanyStateBanner ───────────────────────────────────────────────────────

describe('CompanyStateBanner', () => {
  function renderBanner(status: string, rejectionReason?: string) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CompanyStateBanner
          status={status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'}
          rejectionReason={rejectionReason}
        />
      </NextIntlClientProvider>,
    );
  }

  it('renders nothing for APPROVED status', () => {
    const { container } = renderBanner('APPROVED');
    expect(container.firstChild).toBeNull();
  });

  it('shows info banner for PENDING status', () => {
    renderBanner('PENDING');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/under review/i)).toBeInTheDocument();
  });

  it('shows alert banner with rejection reason for REJECTED status', () => {
    renderBanner('REJECTED', 'Certificate could not be verified.');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Certificate could not be verified.')).toBeInTheDocument();
    expect(screen.getByText(/resubmit/i)).toBeInTheDocument();
  });

  it('shows fallback text when rejection reason is null', () => {
    renderBanner('REJECTED', null as unknown as string);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/please review/i)).toBeInTheDocument();
  });

  it('shows error alert for SUSPENDED status', () => {
    renderBanner('SUSPENDED');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/suspended/i)).toBeInTheDocument();
    expect(screen.getByText(/contact support/i)).toBeInTheDocument();
  });
});

// ─── EmployerSidebar — Post a Job gating ─────────────────────────────────────

describe('EmployerSidebar — Post a Job approval gate', () => {
  it('disables "Post a Job" when company is not APPROVED', async () => {
    loginAsEmployer(EMPLOYER_PENDING_USER_ID);
    render(
      <Wrapper>
        <EmployerSidebar />
      </Wrapper>,
    );

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /post a job/i });
      expect(btn).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('enables "Post a Job" link when company is APPROVED', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);
    render(
      <Wrapper>
        <EmployerSidebar />
      </Wrapper>,
    );

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /post a job/i });
      expect(link).toBeInTheDocument();
      expect(link).not.toHaveAttribute('aria-disabled');
    });
  });
});

// ─── PlanStatusWidget — live subscription states (MSW) ───────────────────────

describe('PlanStatusWidget', () => {
  it('Free employer shows free plan UI + upgrade link', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlanStatusWidget />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/free plan/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /upgrade/i })).toBeInTheDocument();
    });
  });

  it('Pro employer shows plan name and days remaining', async () => {
    loginAsEmployer(EMPLOYER_PRO_USER_ID);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlanStatusWidget />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/pro monthly/i)).toBeInTheDocument();
      expect(screen.getByText(/days? left/i)).toBeInTheDocument();
    });
  });

  it('Grace employer shows grace label + renew link', async () => {
    loginAsEmployer(EMPLOYER_GRACE_USER_ID);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlanStatusWidget />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      // Widget shows "Pro Monthly (Grace)" AND "Grace ends in…", both matching /grace/
      expect(screen.getAllByText(/grace/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: /renew now/i })).toBeInTheDocument();
    });
  });
});

// ─── useEmployer — loads company; screens get it from context ─────────────────

describe('useEmployer context', () => {
  it('loads company for approved employer', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    const { EmployerProvider: EP, useEmployer } =
      await import('../../../lib/employer/employer-context');

    function CompanyName() {
      const { company, isLoading } = useEmployer();
      if (isLoading) return <span>Loading</span>;
      return <span data-testid="name">{company?.name ?? 'null'}</span>;
    }

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AuthProvider>
          <EP>
            <CompanyName />
          </EP>
        </AuthProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('name')).toHaveTextContent('Gulf Builders Arabia'),
    );
  });

  it('exposes null company for employer with no company (404)', async () => {
    // Override the handler to return 404 for this test
    server.use(
      http.get('/api/v1/employers/me/company', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            detail: 'no company',
            code: 'NOT_FOUND',
          },
          { status: 404 },
        ),
      ),
    );

    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    const { EmployerProvider: EP, useEmployer } =
      await import('../../../lib/employer/employer-context');

    function CompanyName() {
      const { company, isLoading } = useEmployer();
      if (isLoading) return <span>Loading</span>;
      return <span data-testid="name">{company?.name ?? 'null'}</span>;
    }

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AuthProvider>
          <EP>
            <CompanyName />
          </EP>
        </AuthProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('null'));
  });
});

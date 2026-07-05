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
import { getSubscription } from '@/lib/api/employer';

// ─── Mock next navigation ─────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/employer/dashboard',
  useParams: () => ({ locale: 'en' }),
}));

// ─── Partial mock of employer API — only getSubscription is mocked ────────────
// getCompany and others remain real (MSW-intercepted) so sidebar/context tests
// continue to exercise the full stack.

vi.mock('@/lib/api/employer', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api/employer')>();
  // Default: 501 stub (Sprint 5 not implemented). PlanStatusWidget catches this and
  // shows the Free Plan fallback. Individual tests can override with vi.mocked().
  return { ...mod, getSubscription: vi.fn().mockRejectedValue(new Error('stub: 501')) };
});

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

// ─── PlanStatusWidget — free plan fallback ────────────────────────────────────

describe('PlanStatusWidget', () => {
  it('shows free plan UI when billing endpoint returns 501', async () => {
    vi.mocked(getSubscription).mockRejectedValue(new Error('501 Not Implemented'));

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlanStatusWidget />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/free plan/i)).toBeInTheDocument();
      // Use role query to avoid matching "Upgrade for more active jobs" hint text
      expect(screen.getByRole('link', { name: /upgrade/i })).toBeInTheDocument();
    });
  });

  it('shows days-left when subscription has expiresAt', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(getSubscription).mockResolvedValue({
      planName: 'Pro Plan',
      planKey: 'PRO',
      expiresAt: futureDate,
      activeJobsLimit: 10,
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlanStatusWidget />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/pro plan/i)).toBeInTheDocument();
      expect(screen.getByText(/days? left/i)).toBeInTheDocument();
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

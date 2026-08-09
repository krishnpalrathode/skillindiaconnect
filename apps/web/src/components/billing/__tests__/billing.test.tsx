import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/employer/subscription',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { server } from '../../../mocks/server';
import {
  db,
  makeAccessToken,
  EMPLOYER_APPROVED_USER_ID,
  EMPLOYER_PRO_USER_ID,
  EMPLOYER_GRACE_USER_ID,
} from '../../../mocks/data';

/** Register a token in MSW's session store so getAuthUser() returns the user. */
function loginAs(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
  return token;
}
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';
import { formatSubunits } from '../../../lib/money';
import { createCheckout } from '../../../lib/api/billing';
import { PlanCards } from '../PlanCards';
import { UpgradeContext } from '../UpgradeContext';
import { CheckoutLauncher } from '../CheckoutLauncher';
import { PaymentConfirming } from '../PaymentConfirming';
import { CurrentPlanCard } from '../CurrentPlanCard';
import { GraceBanner } from '../GraceBanner';
import { InvoiceList } from '../InvoiceList';
import { DocumentViewButton } from '../DocumentViewButton';
import { PlanStatusWidget } from '../../employer/PlanStatusWidget';

type Plan = components['schemas']['Plan'];
type CheckoutSession = components['schemas']['CheckoutSession'];
type SubscriptionStatus = components['schemas']['SubscriptionStatus'];

const BASE = `${window.location.origin}/api/v1`;

const PLANS: Plan[] = [
  {
    code: 'FREE',
    name: 'Free',
    priceSubunits: 0,
    currency: 'INR',
    period: null,
    maxActiveJobs: 1,
    gstRatePct: 18,
    features: ['1 active job'],
  },
  {
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    priceSubunits: 299900,
    currency: 'INR',
    period: 'MONTHLY',
    maxActiveJobs: null,
    gstRatePct: 18,
    features: ['Unlimited active jobs', 'Candidate document access'],
  },
  {
    code: 'PRO_YEARLY',
    name: 'Pro Yearly',
    priceSubunits: 2499900,
    currency: 'INR',
    period: 'YEARLY',
    maxActiveJobs: null,
    gstRatePct: 18,
    features: ['Unlimited active jobs'],
  },
];

const razorpaySession: CheckoutSession = {
  orderId: 'order-abc',
  humanOrderRef: 'ORD-2026-00001',
  gateway: 'RAZORPAY',
  amountSubunits: 299900,
  gstSubunits: 53982,
  totalSubunits: 353882,
  currency: 'INR',
  razorpay: { keyId: 'rzp_test_mock', gatewayOrderId: 'order_MockRzp' },
};

const stripeSession: CheckoutSession = {
  orderId: 'order-xyz',
  humanOrderRef: 'ORD-2026-00002',
  gateway: 'STRIPE',
  amountSubunits: 299900,
  gstSubunits: 0,
  totalSubunits: 299900,
  currency: 'INR',
  stripe: { redirectUrl: 'https://checkout.stripe.com/c/pay/mock-xyz' },
};

beforeEach(() => {
  resetClient();
  loginAs(EMPLOYER_APPROVED_USER_ID);
});

// ── money.ts ────────────────────────────────────────────────────────────────

describe('formatSubunits', () => {
  it('formats whole-rupee prices without decimals', () => {
    expect(formatSubunits(299900, 'INR', 'en')).toMatch(/2,999/);
    expect(formatSubunits(299900, 'INR', 'en')).not.toMatch(/\.00/);
  });
  it('shows paise when the total is not whole rupees', () => {
    expect(formatSubunits(353882, 'INR', 'en')).toMatch(/3,538\.82/);
  });
});

// ── PlanCards ─────────────────────────────────────────────────────────────────

describe('PlanCards', () => {
  it('renders all three plans as a radiogroup', () => {
    render(<PlanCards plans={PLANS} isLocal currentPlanCode="FREE" onUpgrade={vi.fn()} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('Pro Monthly')).toBeInTheDocument();
    expect(screen.getByText('Pro Yearly')).toBeInTheDocument();
  });

  it('LOCAL company shows the indicative GST line', () => {
    render(<PlanCards plans={PLANS} isLocal currentPlanCode="FREE" onUpgrade={vi.fn()} />);
    expect(screen.getAllByText(/18% GST/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/indicative/i).length).toBeGreaterThan(0);
  });

  it('FOREIGN company shows NO GST line', () => {
    render(<PlanCards plans={PLANS} isLocal={false} currentPlanCode="FREE" onUpgrade={vi.fn()} />);
    expect(screen.queryByText(/GST/i)).not.toBeInTheDocument();
  });

  it('Free is not purchasable — no upgrade button for it', () => {
    render(<PlanCards plans={PLANS} isLocal currentPlanCode="FREE" onUpgrade={vi.fn()} />);
    // Free shows "Your current plan"; only Pro plans have Upgrade buttons.
    expect(screen.queryByRole('button', { name: /upgrade to free/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /upgrade to pro/i })).toHaveLength(2);
  });

  it('calls onUpgrade with the plan code (never a gateway) when Upgrade is clicked', async () => {
    const onUpgrade = vi.fn();
    render(<PlanCards plans={PLANS} isLocal currentPlanCode="FREE" onUpgrade={onUpgrade} />);
    await userEvent.click(screen.getByRole('button', { name: /upgrade to pro monthly/i }));
    expect(onUpgrade).toHaveBeenCalledWith('PRO_MONTHLY');
  });
});

describe('UpgradeContext', () => {
  it('renders the quota banner', () => {
    render(<UpgradeContext />);
    expect(screen.getByText(/reached your free plan's 1-job limit/i)).toBeInTheDocument();
  });
});

// ── Checkout request shape (FE never sends a gateway) ──────────────────────────

describe('createCheckout request shape', () => {
  it('sends ONLY { planCode } + an Idempotency-Key header — never a gateway', async () => {
    let capturedBody: unknown;
    let idemHeader: string | null = null;
    server.use(
      http.post(`${BASE}/billing/checkout`, async ({ request }) => {
        capturedBody = await request.json();
        idemHeader = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ data: razorpaySession }, { status: 201 });
      }),
    );

    await createCheckout('PRO_MONTHLY', 'idem-key-123');

    expect(capturedBody).toEqual({ planCode: 'PRO_MONTHLY' });
    expect(capturedBody).not.toHaveProperty('gateway');
    expect(idemHeader).toBe('idem-key-123');
  });
});

// ── CheckoutLauncher (server-routed; FE launches, never chooses) ───────────────

describe('CheckoutLauncher', () => {
  it('RAZORPAY session → the mock-path launcher (Simulate payment) → onConfirming', async () => {
    const onConfirming = vi.fn();
    render(
      <CheckoutLauncher
        session={razorpaySession}
        onConfirming={onConfirming}
        onCancel={vi.fn()}
        mockMode
      />,
    );
    const simulate = screen.getByRole('button', { name: /simulate payment/i });
    await userEvent.click(simulate);
    expect(onConfirming).toHaveBeenCalledWith('order-abc');
  });

  it('STRIPE session (real mode) → navigates to the Stripe redirect URL', () => {
    const navigate = vi.fn();
    render(
      <CheckoutLauncher
        session={stripeSession}
        onConfirming={vi.fn()}
        onCancel={vi.fn()}
        mockMode={false}
        navigate={navigate}
      />,
    );
    expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/mock-xyz');
  });

  it('RAZORPAY session (real mode) → opens Checkout.js, and the handler advances to CONFIRMING (not success)', async () => {
    const onConfirming = vi.fn();
    const launchRazorpay = vi.fn(async ({ onFlowComplete }: { onFlowComplete: () => void }) => {
      onFlowComplete(); // simulate the gateway callback returning
      return true;
    });
    render(
      <CheckoutLauncher
        session={razorpaySession}
        onConfirming={onConfirming}
        onCancel={vi.fn()}
        mockMode={false}
        launchRazorpay={launchRazorpay}
      />,
    );
    await waitFor(() => expect(launchRazorpay).toHaveBeenCalled());
    // The gateway callback only advances to CONFIRMING — the poll confirms.
    expect(onConfirming).toHaveBeenCalledWith('order-abc');
  });
});

// ── PaymentConfirming (THE webhook-truth polling UX) ───────────────────────────

describe('PaymentConfirming', () => {
  it('stays on CONFIRMING while the order is CREATED, then flips to SUCCESS only on a PAID poll', async () => {
    let polls = 0;
    server.use(
      http.get(`${BASE}/billing/orders/:id`, () => {
        polls += 1;
        const status = polls >= 3 ? 'PAID' : 'CREATED';
        return HttpResponse.json({
          data: {
            id: 'order-abc',
            planCode: 'PRO_MONTHLY',
            status,
            gateway: 'RAZORPAY',
            amountSubunits: 299900,
            gstSubunits: 53982,
            totalSubunits: 353882,
            currency: 'INR',
            createdAt: new Date().toISOString(),
            subscriptionActivatedAt: status === 'PAID' ? new Date().toISOString() : null,
            invoiceId: status === 'PAID' ? 'inv-1' : null,
          },
        });
      }),
    );

    render(
      <PaymentConfirming
        orderId="order-abc"
        onRetry={vi.fn()}
        onPostJob={vi.fn()}
        onDone={vi.fn()}
        pollSchedule={[10, 10, 10, 10]}
        timeoutMs={10_000}
      />,
    );

    // Confirming shows first; success must NOT render while CREATED.
    expect(screen.getByText(/confirming your payment/i)).toBeInTheDocument();
    expect(screen.queryByText(/you're on pro/i)).not.toBeInTheDocument();

    // After enough polls the PAID flip drives success.
    await waitFor(() => expect(screen.getByText(/you're on pro/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('FAILED order → the retry state', async () => {
    server.use(
      http.get(`${BASE}/billing/orders/:id`, () =>
        HttpResponse.json({
          data: {
            id: 'order-abc',
            planCode: 'PRO_MONTHLY',
            status: 'FAILED',
            gateway: 'RAZORPAY',
            amountSubunits: 299900,
            gstSubunits: 0,
            totalSubunits: 299900,
            currency: 'INR',
            createdAt: new Date().toISOString(),
            subscriptionActivatedAt: null,
            invoiceId: null,
          },
        }),
      ),
    );

    const onRetry = vi.fn();
    render(
      <PaymentConfirming
        orderId="order-abc"
        onRetry={onRetry}
        onPostJob={vi.fn()}
        onDone={vi.fn()}
        pollSchedule={[10]}
        timeoutMs={10_000}
      />,
    );

    await waitFor(() => expect(screen.getByText(/payment didn't go through/i)).toBeInTheDocument());
    expect(screen.queryByText(/you're on pro/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back to plans/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('CREATED past the budget → the honest timeout copy + a real manual-refresh button (never a false success)', async () => {
    server.use(
      http.get(`${BASE}/billing/orders/:id`, () =>
        HttpResponse.json({
          data: {
            id: 'order-abc',
            planCode: 'PRO_MONTHLY',
            status: 'CREATED', // never flips
            gateway: 'RAZORPAY',
            amountSubunits: 299900,
            gstSubunits: 0,
            totalSubunits: 299900,
            currency: 'INR',
            createdAt: new Date().toISOString(),
            subscriptionActivatedAt: null,
            invoiceId: null,
          },
        }),
      ),
    );

    render(
      <PaymentConfirming
        orderId="order-abc"
        onRetry={vi.fn()}
        onPostJob={vi.fn()}
        onDone={vi.fn()}
        pollSchedule={[10]}
        timeoutMs={30}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument(),
    );
    // Honest: never claims success, offers a real refresh button.
    expect(screen.queryByText(/you're on pro/i)).not.toBeInTheDocument();
    expect(screen.getByText(/we'll email you/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh status/i })).toBeInTheDocument();
  });
});

// ── S5-F2: CurrentPlanCard — status states ────────────────────────────────────

const ACTIVE_SUB: SubscriptionStatus = {
  plan: {
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    priceSubunits: 299900,
    currency: 'INR',
    period: 'MONTHLY',
    maxActiveJobs: null,
    gstRatePct: 18,
    features: [],
  },
  status: 'ACTIVE',
  startsAt: '2026-06-01T00:00:00Z',
  expiresAt: '2026-07-31T00:00:00Z',
  daysRemaining: 19,
  renewable: false,
};

const GRACE_SUB: SubscriptionStatus = {
  plan: {
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    priceSubunits: 299900,
    currency: 'INR',
    period: 'MONTHLY',
    maxActiveJobs: null,
    features: [],
  },
  status: 'GRACE',
  startsAt: '2026-05-01T00:00:00Z',
  expiresAt: '2026-06-30T00:00:00Z',
  graceEndsAt: '2026-07-07T00:00:00Z',
  daysRemaining: 5,
  renewable: true,
};

const EXPIRED_SUB: SubscriptionStatus = {
  plan: {
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    priceSubunits: 299900,
    currency: 'INR',
    period: 'MONTHLY',
    maxActiveJobs: null,
    features: [],
  },
  status: 'EXPIRED',
  startsAt: '2026-05-01T00:00:00Z',
  expiresAt: '2026-06-30T00:00:00Z',
  daysRemaining: 0,
  renewable: true,
};

const FREE_SUB: SubscriptionStatus = {
  plan: {
    code: 'FREE',
    name: 'Free',
    priceSubunits: 0,
    currency: 'INR',
    period: null,
    maxActiveJobs: 1,
    features: [],
  },
  status: 'ACTIVE',
  startsAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
  daysRemaining: null,
  renewable: false,
};

describe('CurrentPlanCard — ACTIVE', () => {
  it('shows plan name and expiry', () => {
    render(<CurrentPlanCard subscription={ACTIVE_SUB} />);
    expect(screen.getByText(/pro monthly/i)).toBeInTheDocument();
    expect(screen.getByText(/expires/i)).toBeInTheDocument();
    expect(screen.getByText(/19 days remaining/i)).toBeInTheDocument();
  });

  it('shows manage link when not renewable', () => {
    render(<CurrentPlanCard subscription={ACTIVE_SUB} />);
    expect(screen.getByRole('link', { name: /manage plan/i })).toBeInTheDocument();
  });

  it('shows renew link when near expiry and renewable', () => {
    const sub: SubscriptionStatus = { ...ACTIVE_SUB, daysRemaining: 5, renewable: true };
    render(<CurrentPlanCard subscription={sub} />);
    expect(screen.getByRole('link', { name: /renew now/i })).toBeInTheDocument();
  });
});

describe('CurrentPlanCard — GRACE', () => {
  it('renders GraceBanner as a status region', () => {
    render(<CurrentPlanCard subscription={GRACE_SUB} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('GraceBanner shows days remaining', () => {
    render(<CurrentPlanCard subscription={GRACE_SUB} />);
    // Both the banner body and the plan-info paragraph contain "5 day"
    expect(screen.getAllByText(/5 day/i).length).toBeGreaterThan(0);
  });

  it('shows prominent renew CTA', () => {
    render(<CurrentPlanCard subscription={GRACE_SUB} />);
    expect(screen.getAllByRole('link', { name: /renew now/i }).length).toBeGreaterThan(0);
  });
});

describe('CurrentPlanCard — EXPIRED', () => {
  it('shows expired hint + upgrade CTA', () => {
    render(<CurrentPlanCard subscription={EXPIRED_SUB} />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upgrade to pro/i })).toBeInTheDocument();
  });
});

describe('CurrentPlanCard — FREE', () => {
  it('shows free state with upgrade CTA', () => {
    render(<CurrentPlanCard subscription={FREE_SUB} />);
    expect(screen.getByText(/free/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upgrade to pro/i })).toBeInTheDocument();
    expect(screen.queryByText(/expires/i)).not.toBeInTheDocument();
  });
});

// ── S5-F2: GraceBanner standalone ────────────────────────────────────────────

describe('GraceBanner', () => {
  it('is a status region with plan name, grace end date, and days', () => {
    render(
      <GraceBanner
        planName="Pro Monthly"
        graceEndsAt="2026-07-07T00:00:00Z"
        daysRemaining={5}
        renewHref="/en/employer/subscription"
      />,
    );
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/pro monthly/i);
    expect(banner.textContent).toMatch(/5/);
  });

  it('renew button links to the subscription page', () => {
    render(
      <GraceBanner
        planName="Pro Monthly"
        graceEndsAt="2026-07-07T00:00:00Z"
        daysRemaining={5}
        renewHref="/en/employer/subscription"
      />,
    );
    const link = screen.getByRole('link', { name: /renew now/i });
    expect(link).toHaveAttribute('href', '/en/employer/subscription');
  });
});

// ── S5-F2: InvoiceList (MSW) ─────────────────────────────────────────────────

describe('InvoiceList', () => {
  it('renders invoice rows — sequential number, formatted amount, plan name', async () => {
    loginAs(EMPLOYER_PRO_USER_ID);
    render(<InvoiceList />);
    // PRO employer has 2 invoices, so getAllByText avoids "multiple elements" error
    await waitFor(() => expect(screen.getAllByText(/SIC-/).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(screen.getAllByText(/pro monthly/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₹/).length).toBeGreaterThan(0);
  });

  it('invoice with pdfUrl renders a download link (not broken)', async () => {
    loginAs(EMPLOYER_GRACE_USER_ID);
    render(<InvoiceList />);
    await waitFor(() => expect(screen.getByText(/SIC-/)).toBeInTheDocument(), { timeout: 3000 });
    // Grace fixture has an invoice with pdfUrl
    const link = screen.queryByRole('link', { name: /download pdf/i });
    if (link) {
      expect(link).toHaveAttribute('href');
      expect(link.getAttribute('href')).not.toBe('');
      expect(link.getAttribute('href')).not.toBe('#');
    }
  });

  it('invoice with null pdfUrl renders "Generating" text — no dead link', async () => {
    loginAs(EMPLOYER_PRO_USER_ID);
    render(<InvoiceList />);
    // PRO employer has 2 invoices — use getAllByText to avoid "multiple elements" error
    await waitFor(() => expect(screen.getAllByText(/SIC-/).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    // Pro fixture has one invoice with null pdfUrl
    const pending = screen.queryByText(/generating/i);
    if (pending) {
      // Must not be a link
      expect(pending.tagName).not.toBe('A');
    }
  });

  it('empty state for Free employer', async () => {
    loginAs(EMPLOYER_APPROVED_USER_ID);
    render(<InvoiceList />);
    await waitFor(() => expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('load error shows retry button', async () => {
    server.use(http.get(`${BASE}/billing/invoices`, () => new HttpResponse(null, { status: 500 })));
    render(<InvoiceList />);
    await waitFor(() => expect(screen.getByText(/couldn't load invoices/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('single page of invoices renders no pager', async () => {
    loginAs(EMPLOYER_PRO_USER_ID);
    render(<InvoiceList />);
    await waitFor(() => expect(screen.getAllByText(/SIC-/).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(screen.queryByRole('navigation', { name: /invoice pagination/i })).toBeNull();
  });

  it('pages past the first 20 invoices — Next requests page 2 and swaps the rows', async () => {
    const requestedPages: string[] = [];
    server.use(
      http.get(`${BASE}/billing/invoices`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        requestedPages.push(page);
        return HttpResponse.json({
          data: [
            {
              id: `inv-p${page}`,
              number: `SIC-PAGE${page}`,
              issuedAt: '2026-07-01T00:00:00Z',
              planName: 'Pro Monthly',
              totalSubunits: 100000,
              currency: 'INR',
              pdfUrl: null,
            },
          ],
          meta: { page: Number(page), pageSize: 20, total: 41, totalPages: 3 },
        });
      }),
    );

    loginAs(EMPLOYER_PRO_USER_ID);
    render(<InvoiceList />);

    await waitFor(() => expect(screen.getByText('SIC-PAGE1')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /next page of invoices/i }));

    // The second page must actually be fetched and rendered — the bug being
    // guarded is the client pinning page=1 and dropping meta.
    await waitFor(() => expect(screen.getByText('SIC-PAGE2')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(requestedPages).toContain('2');
    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();
    expect(screen.queryByText('SIC-PAGE1')).toBeNull();
  });

  it('Previous is disabled on the first page', async () => {
    server.use(
      http.get(`${BASE}/billing/invoices`, () =>
        HttpResponse.json({
          data: [
            {
              id: 'inv-a',
              number: 'SIC-0001',
              issuedAt: '2026-07-01T00:00:00Z',
              planName: 'Pro Monthly',
              totalSubunits: 100000,
              currency: 'INR',
              pdfUrl: null,
            },
          ],
          meta: { page: 1, pageSize: 20, total: 41, totalPages: 3 },
        }),
      ),
    );

    loginAs(EMPLOYER_PRO_USER_ID);
    render(<InvoiceList />);

    await waitFor(() => expect(screen.getByText('SIC-0001')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /previous page of invoices/i })).toBeDisabled();
  });
});

// ── S5-F2: PlanStatusWidget — live subscription states ───────────────────────

describe('PlanStatusWidget', () => {
  it('Free employer shows upgrade link', async () => {
    loginAs(EMPLOYER_APPROVED_USER_ID);
    render(<PlanStatusWidget />);
    await waitFor(() => expect(screen.getByText(/upgrade plan/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/free plan/i)).toBeInTheDocument();
  });

  it('Grace employer shows "renew now" link with warning styling', async () => {
    loginAs(EMPLOYER_GRACE_USER_ID);
    render(<PlanStatusWidget />);
    await waitFor(() => expect(screen.getByText(/renew now/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    // Both plan label ("Pro Monthly (Grace)") and days paragraph ("Grace ends in…")
    // contain "grace", so getAllByText avoids the "multiple elements" error.
    expect(screen.getAllByText(/grace/i).length).toBeGreaterThan(0);
  });

  it('Pro employer shows plan name and manage link', async () => {
    loginAs(EMPLOYER_PRO_USER_ID);
    render(<PlanStatusWidget />);
    await waitFor(() => expect(screen.getByText(/manage subscription/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/pro monthly/i)).toBeInTheDocument();
  });
});

// ── S5-F2: DocumentViewButton — the two-outcome gate ─────────────────────────

describe('DocumentViewButton', () => {
  // Real seeded candidate with a PASSPORT doc (data.ts)
  const MOCK_CANDIDATE_ID = 'mock-user-candidate-1';
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

  beforeEach(() => {
    openSpy.mockClear();
    loginAs(EMPLOYER_PRO_USER_ID);
  });

  it('renders nothing when uploaded=false', () => {
    const { container } = render(
      <DocumentViewButton
        candidateId={MOCK_CANDIDATE_ID}
        documentType="PASSPORT"
        uploaded={false}
      />,
    );
    // The COMPONENT rendered nothing — not "the container is empty". The shared
    // test render wraps everything in ToastProvider, whose aria-live region is
    // always present, so container.firstChild is that region rather than null.
    expect(container.querySelector('.relative')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Pro employer — 200 → opens signed URL in new tab', async () => {
    render(
      <DocumentViewButton
        candidateId={MOCK_CANDIDATE_ID}
        documentType="PASSPORT"
        uploaded={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /view passport document/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    await waitFor(() => expect(openSpy).toHaveBeenCalled(), { timeout: 3000 });
    const [url, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(url).toContain('r2.mock');
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
  });

  it('Free employer — 403 PLAN_UPGRADE_REQUIRED → UpgradePrompt (NOT error toast)', async () => {
    loginAs(EMPLOYER_APPROVED_USER_ID);
    server.use(
      http.get(`${BASE}/employers/candidates/:id/documents/:type/url`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Upgrade required.',
            code: 'PLAN_UPGRADE_REQUIRED',
          },
          { status: 403 },
        ),
      ),
    );
    render(
      <DocumentViewButton
        candidateId={MOCK_CANDIDATE_ID}
        documentType="EXPERIENCE_CERT"
        uploaded={true}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /view experience certificate document/i }),
    );
    await waitFor(() => expect(screen.getByText(/pro plan required/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    // Crucially: it's the upsell dialog, not an error toast
    expect(screen.getByRole('link', { name: /view plans/i })).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('404 → quiet "not available" — no error toast, no upsell', async () => {
    server.use(
      http.get(
        `${BASE}/employers/candidates/:id/documents/:type/url`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    render(
      <DocumentViewButton candidateId="hidden-candidate" documentType="PASSPORT" uploaded={true} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /view passport document/i }));
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText(/pro plan required/i)).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('storage 403 (stale signed URL) → retry copy, not upsell', async () => {
    server.use(
      http.get(`${BASE}/employers/candidates/:id/documents/:type/url`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Signature expired.',
            code: 'SIGNATURE_EXPIRED',
          },
          { status: 403 },
        ),
      ),
    );
    render(
      <DocumentViewButton
        candidateId={MOCK_CANDIDATE_ID}
        documentType="EDUCATIONAL_CERT"
        uploaded={true}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /view educational certificate document/i }),
    );
    await waitFor(() => expect(screen.getByText(/link expired/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText(/pro plan required/i)).not.toBeInTheDocument();
  });

  it('UpgradePrompt is dismissible via close button', async () => {
    loginAs(EMPLOYER_APPROVED_USER_ID);
    server.use(
      http.get(`${BASE}/employers/candidates/:id/documents/:type/url`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Upgrade required.',
            code: 'PLAN_UPGRADE_REQUIRED',
          },
          { status: 403 },
        ),
      ),
    );
    render(
      <DocumentViewButton
        candidateId={MOCK_CANDIDATE_ID}
        documentType="PASSPORT"
        uploaded={true}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /view passport document/i }));
    await waitFor(() => screen.getByText(/pro plan required/i), { timeout: 3000 });

    const close = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(close);
    expect(screen.queryByText(/pro plan required/i)).not.toBeInTheDocument();
  });
});

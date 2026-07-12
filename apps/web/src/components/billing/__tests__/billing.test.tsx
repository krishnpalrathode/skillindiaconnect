import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { server } from '../../../mocks/server';
import { makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';
import { formatSubunits } from '../../../lib/money';
import { createCheckout } from '../../../lib/api/billing';
import { PlanCards } from '../PlanCards';
import { UpgradeContext } from '../UpgradeContext';
import { CheckoutLauncher } from '../CheckoutLauncher';
import { PaymentConfirming } from '../PaymentConfirming';

type Plan = components['schemas']['Plan'];
type CheckoutSession = components['schemas']['CheckoutSession'];

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
  setAccessToken(makeAccessToken('mock-user-employer-local'));
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

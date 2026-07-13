import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../../../test-utils';
import { server } from '../../../../mocks/server';
import {
  db,
  makeAccessToken,
  SUPER_ADMIN_USER_ID,
  MODERATOR_USER_ID,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider } from '../../../../lib/admin/admin-context';
import { EmployerQueueTable } from '../EmployerQueueTable';
import { EmployerReviewPanel } from '../EmployerReviewPanel';
import { CertificateViewer } from '../CertificateViewer';
import { SuspendDialog } from '../SuspendDialog';
import { RejectDialog } from '../RejectDialog';

// URL state the table reads. Mutable per test.
let mockSearch = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/employers',
  useSearchParams: () => mockSearch,
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

/** The seeded PENDING company (data.ts mirrors the API seed's Al Noor). */
function pendingCompany() {
  const c = [...db.employers.values()].find((x) => x.status === 'PENDING');
  if (!c) throw new Error('fixture: no PENDING company seeded');
  return c;
}
function approvedCompany() {
  const c = [...db.employers.values()].find((x) => x.status === 'APPROVED');
  if (!c) throw new Error('fixture: no APPROVED company seeded');
  return c;
}

beforeEach(() => {
  resetClient();
  mockSearch = new URLSearchParams();
});
afterEach(() => {
  resetClient();
  vi.clearAllMocks();
});

// ─── The queue ────────────────────────────────────────────────────────────────

describe('EmployerQueueTable', () => {
  it('lands on PENDING by default — the dashboard deep-link view', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(<EmployerQueueTable />);

    // Only the PENDING fixture row appears; approved companies are filtered out.
    const pending = pendingCompany();
    const approved = approvedCompany();
    await waitFor(() => expect(screen.getByText(pending.name)).toBeInTheDocument());
    expect(screen.queryByText(approved.name)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pending review/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('?status=SUSPENDED from the URL selects that filter (deep links reproduce the view)', async () => {
    mockSearch = new URLSearchParams('status=SUSPENDED');
    signInAs(SUPER_ADMIN_USER_ID);
    render(<EmployerQueueTable />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /suspended/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    // Only the SUSPENDED fixture shows; the pending one is filtered out.
    const suspended = [...db.employers.values()].find((c) => c.status === 'SUSPENDED');
    expect(suspended).toBeDefined();
    await waitFor(() => expect(screen.getByText(suspended!.name)).toBeInTheDocument());
    expect(screen.queryByText(pendingCompany().name)).not.toBeInTheDocument();
  });

  it('search updates the URL (state lives in the URL, not the component)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // Filter changes go through NATIVE history (shallow routing) — a filter is
    // client state; router.replace would fire a wasted RSC round-trip per click.
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(<EmployerQueueTable />);
    await waitFor(() => expect(screen.getByText(pendingCompany().name)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/search companies/i), 'Noor');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(replaceState).toHaveBeenCalledWith(null, '', expect.stringContaining('search=Noor'));
    replaceState.mockRestore();
  });
});

// ─── The certificate viewer ───────────────────────────────────────────────────

describe('CertificateViewer', () => {
  it('fetches the signed URL and renders the document inline (+ open in new tab)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // The APPROVED fixture has a certificate on file; the PENDING one deliberately
    // does not (it exercises the no-cert state instead).
    const company = approvedCompany();
    render(<CertificateViewer companyId={company.id} />);

    // The mock grant returns a .pdf URL → iframe render path.
    await waitFor(() => expect(screen.getByTitle(/registration certificate/i)).toBeInTheDocument());
    const iframe = screen.getByTitle(/registration certificate/i);
    expect(iframe).toHaveAttribute('src', expect.stringContaining(company.id));

    const newTab = screen.getByRole('link', { name: /open in new tab/i });
    expect(newTab).toHaveAttribute('target', '_blank');
  });

  it('no certificate on file → the honest state, not a blocker or a crash', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const company = approvedCompany();
    const prevKey = company.registrationCertKey;
    company.registrationCertKey = null; // the 404 branch (indistinguishable from unknown id)

    render(<CertificateViewer companyId={company.id} />);
    await waitFor(() => expect(screen.getByText(/no certificate uploaded/i)).toBeInTheDocument());
    // It explicitly tells the admin the call is theirs to make without the document.
    expect(screen.getByText(/without the document/i)).toBeInTheDocument();

    company.registrationCertKey = prevKey;
  });

  it('a failed/expired link → "refresh link" re-mints and recovers', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const company = approvedCompany();

    // First mint fails (the short-lived URL died / transient failure)…
    server.use(
      http.get(
        '/api/v1/admin/employers/:id/certificate/url',
        () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Error', status: 500, detail: 'boom', code: 'ERROR' },
            { status: 500 },
          ),
        { once: true },
      ),
    );

    render(<CertificateViewer companyId={company.id} />);
    await waitFor(() =>
      expect(screen.getByText(/link expired or failed to load/i)).toBeInTheDocument(),
    );

    // …the refresh affordance re-mints against the restored handler and recovers.
    await userEvent.click(screen.getByRole('button', { name: /refresh link/i }));
    await waitFor(() => expect(screen.getByTitle(/registration certificate/i)).toBeInTheDocument());
  });
});

// ─── The dialogs' load-bearing copy ──────────────────────────────────────────

describe('RejectDialog — the mandatory, employer-visible reason', () => {
  it('blocks submit while empty and says the reason is employer-visible', async () => {
    const onConfirm = vi.fn();
    render(
      <RejectDialog
        companyName="Al Noor Recruitment"
        busy={false}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    // The visibility warning is in the dialog, in plain words.
    expect(screen.getByText(/shown to the employer.*emailed to them/i)).toBeInTheDocument();

    // Empty → the confirm is disabled; nothing fires.
    const confirm = screen.getByRole('button', { name: /reject company/i });
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    // Typing a reason arms it.
    await userEvent.type(
      screen.getByLabelText(/reason for rejection/i),
      'Certificate does not match the company name.',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Certificate does not match the company name.');
  });
});

describe('SuspendDialog — the consequence is named before the click', () => {
  it('states that ALL active jobs will be paused', () => {
    render(
      <SuspendDialog
        companyName="Gulf Builders"
        busy={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/pause all of this employer's active jobs/i)).toBeInTheDocument();
  });
});

// ─── Per-button permission gating (the seed's real boundary) ─────────────────

describe('EmployerReviewPanel — MODERATOR sees Approve/Reject but never Suspend', () => {
  it('PENDING company: a MODERATOR (holds approve_reject) gets both buttons', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        <EmployerReviewPanel companyId={pendingCompany().id} />
      </AdminProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('APPROVED company: the Suspend button does NOT render for a MODERATOR (lacks employers.suspend)', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        <EmployerReviewPanel companyId={approvedCompany().id} />
      </AdminProvider>,
    );

    // Wait for the panel itself (the facts heading) so the absence is post-load.
    await waitFor(() => expect(screen.getByText(/company details/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });

  it('APPROVED company: SUPER_ADMIN gets the Suspend button', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <EmployerReviewPanel companyId={approvedCompany().id} />
      </AdminProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument(),
    );
  });
});

// ─── The full reject round-trip ──────────────────────────────────────────────

describe('reject round-trip', () => {
  it('rejecting with a reason updates the status to REJECTED (refetched, not optimistic)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const company = pendingCompany();
    const prevStatus = company.status;
    const prevReason = company.rejectionReason;

    render(
      <AdminProvider>
        <EmployerReviewPanel companyId={company.id} />
      </AdminProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
    await userEvent.type(
      screen.getByLabelText(/reason for rejection/i),
      'Certificate unreadable — please re-upload.',
    );
    await userEvent.click(screen.getByRole('button', { name: /reject company/i }));

    // The panel refetches and shows the server's new state + the visible reason.
    await waitFor(() =>
      expect(screen.getByText(/rejection reason \(visible to the employer\)/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('Certificate unreadable — please re-upload.')).toBeInTheDocument();
    expect(
      db.employers.get(
        [...db.employers.keys()].find((k) => db.employers.get(k)!.id === company.id)!,
      )!.status,
    ).toBe('REJECTED');

    // Restore the shared fixture.
    company.status = prevStatus;
    company.rejectionReason = prevReason;
  });
});

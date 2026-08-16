import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../../../test-utils';
import { server } from '../../../../mocks/server';
import {
  db,
  makeAccessToken,
  ADMIN_USER_ID,
  SUPER_ADMIN_USER_ID,
  SUPPORT_USER_ID,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider, useAdmin } from '../../../../lib/admin/admin-context';
import { AdminJobsTable } from '../AdminJobsTable';
import { JobReviewPanel } from '../JobReviewPanel';
import { OnBehalfJobForm } from '../OnBehalfJobForm';

let mockSearch = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/jobs',
  useSearchParams: () => mockSearch,
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

/** Signals when the permission fetch settled — gated-ABSENCE asserts after it. */
function PermsReady() {
  const { isLoading } = useAdmin();
  return isLoading ? null : <span data-testid="perms-ready" />;
}

beforeEach(() => {
  resetClient();
  mockSearch = new URLSearchParams();
});
afterEach(() => {
  resetClient();
  server.events.removeAllListeners();
  vi.clearAllMocks();
});

// ─── The list + review queue ─────────────────────────────────────────────────

/**
 * A description that clears the 300-character minimum (JOB_DESCRIPTION_MIN).
 *
 * Pasted rather than typed: user.type() sends one keystroke at a time, and 300+
 * of those in jsdom turns a fast test into a slow one for no extra coverage.
 */
const LONG_DESCRIPTION = [
  'We need an experienced worker for a long-term project on a busy commercial',
  'site. The role covers day-to-day installation, maintenance and finishing work',
  'to the standards set by the site supervisor. Accommodation, health insurance',
  'and transport to site are provided. Overtime is available and paid at the',
  'standard rate. Applicants should bring their own basic hand tools.',
].join(' ');

describe('AdminJobsTable', () => {
  it('the dashboard deep-link lands FILTERED: ?status=PENDING_REVIEW shows only the queue', async () => {
    signInAs(ADMIN_USER_ID);
    mockSearch = new URLSearchParams('status=PENDING_REVIEW');
    const seen: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/admin/jobs')) seen.push(url.searchParams);
    });

    render(
      <AdminProvider>
        <AdminJobsTable />
      </AdminProvider>,
    );

    // All three seeded pending jobs, none of the ACTIVE ones.
    await waitFor(() =>
      expect(screen.getByText('Site Supervisor (Awaiting Review)')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Warehouse Loader (Awaiting Review — non-compliant)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Steel Fixer (Awaiting Review — suspended employer)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('General Labourer — Local Sites')).not.toBeInTheDocument();

    const params = seen.find((p) => p.get('status') === 'PENDING_REVIEW');
    expect(params).toBeDefined();

    // The queue banner states the same fact prominently.
    expect(screen.getByText(/3 jobs awaiting review/i)).toBeInTheDocument();
  });

  it('rows carry humanId, company, status badge and the Featured/Urgent chips', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <AdminJobsTable />
      </AdminProvider>,
    );
    const table = await screen.findByRole('table');
    // job-1 is seeded Featured; job-2 is seeded Urgent.
    const rows = within(table).getAllByRole('row');
    const featuredRow = rows.find((r) => within(r).queryByText('JB-2026-00001'));
    expect(featuredRow).toBeDefined();
    expect(within(featuredRow!).getByText('Featured')).toBeInTheDocument();
    const urgentRow = rows.find((r) => within(r).queryByText('JB-2026-00002'));
    expect(within(urgentRow!).getByText('Urgent')).toBeInTheDocument();
  });
});

// ─── The review detail: the pre-emptive warning ──────────────────────────────

describe('JobReviewPanel — the suspended employer is flagged BEFORE approve', () => {
  it('shows the warning + employer link on load, before any button is pressed', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-suspended" />
      </AdminProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByText('Steel Fixer (Awaiting Review — suspended employer)'),
      ).toBeInTheDocument(),
    );
    // The pre-emptive warning — no approve attempt has happened.
    expect(screen.getByText(/this employer is suspended/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open the employer's review page/i });
    expect(link).toHaveAttribute('href', '/en/admin/employers/mock-company-suspended');
    // The job is still rendered as candidates would see it.
    expect(screen.getByText('As candidates would see it')).toBeInTheDocument();
  });
});

// ─── THE HEADLINE TESTS: the three gate failures, distinctly ─────────────────

describe('GateFailureExplainer — the three honest failures', () => {
  it('EMPLOYER_NOT_APPROVED → the suspension explanation + the employer-page remedy link', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-suspended" />
      </AdminProvider>,
    );
    await screen.findByText('Steel Fixer (Awaiting Review — suspended employer)');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));

    const alert = await screen.findByRole('alert');
    // The DISTINCT explanation — not a generic error.
    expect(within(alert).getByText('The employer is no longer approved')).toBeInTheDocument();
    expect(within(alert).getByText(/until they're reinstated/i)).toBeInTheDocument();
    // The remedy: Screen 24.
    expect(
      within(alert).getByRole('link', { name: /open the employer's review page/i }),
    ).toHaveAttribute('href', '/en/admin/employers/mock-company-suspended');
  });

  it('WORKER_PROTECTION_VIOLATION → the failing RULES NAMED from meta + the inline Reject remedy', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-noncompliant" />
      </AdminProvider>,
    );
    await screen.findByText('Warehouse Loader (Awaiting Review — non-compliant)');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('A worker-protection rule blocks this job')).toBeInTheDocument();
    // BOTH failing rules, by name, from the error meta (live settings check).
    expect(within(alert).getByText(/health insurance required/i)).toBeInTheDocument();
    expect(within(alert).getByText(/transportation required/i)).toBeInTheDocument();
    expect(within(alert).getByText(/enabled after this job was submitted/i)).toBeInTheDocument();

    // The remedy is offered INLINE: clicking it opens the reject dialog.
    await user.click(within(alert).getByRole('button', { name: /reject with a reason/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
  });

  it('JOB_QUOTA_EXCEEDED → the plan explanation (leave pending or reject — no bare error)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // The mock review handler does not simulate rung 3 — force it.
    server.use(
      http.post('/api/v1/admin/jobs/:id/review', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'Active-job quota exceeded for the employer plan.',
            code: 'JOB_QUOTA_EXCEEDED',
            meta: { planLimit: 1 },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-review" />
      </AdminProvider>,
    );
    await screen.findByText('Site Supervisor (Awaiting Review)');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText("This would exceed the employer's plan limit"),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/free-plan limit/i)).toBeInTheDocument();
    // The stated remedy: the employer upgrades; the admin can wait or reject.
    expect(within(alert).getByText(/they upgrade their plan/i)).toBeInTheDocument();
  });
});

// ─── Approve success + reject discipline ─────────────────────────────────────

describe('review resolution', () => {
  it('approve (all gates pass) → ACTIVE; the queue count drops; success is stated', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    const job = db.jobs.get('job-pending-review')!;
    try {
      render(
        <AdminProvider>
          <JobReviewPanel jobId="job-pending-review" />
        </AdminProvider>,
      );
      await screen.findByText('Site Supervisor (Awaiting Review)');

      await user.click(screen.getByRole('button', { name: 'Approve' }));
      await user.click(screen.getByRole('button', { name: 'Approve and publish' }));

      await waitFor(() =>
        expect(screen.getByText(/approved — the job is now live/i)).toBeInTheDocument(),
      );
      expect(db.jobs.get('job-pending-review')!.status).toBe('ACTIVE');
    } finally {
      job.status = 'PENDING_REVIEW';
      job.publishedAt = null;
    }
  });

  it('reject: confirm is blocked without a reason, and the copy says the employer reads it', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-noncompliant" />
      </AdminProvider>,
    );
    await screen.findByText('Warehouse Loader (Awaiting Review — non-compliant)');

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');

    // Mandatory reason: disabled until typed.
    const confirm = within(dialog).getByRole('button', { name: 'Reject job' });
    expect(confirm).toBeDisabled();
    // The visibility truth — the employer reads this reason.
    expect(within(dialog).getByText(/this reason is shown to the employer/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Reason'), 'Add health insurance first.');
    expect(confirm).toBeEnabled();
  });
});

// ─── Flags + lifecycle ───────────────────────────────────────────────────────

describe('FlagsControl + lifecycle', () => {
  it('flags are named switches; toggling persists; the effect is explained', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    const meta = db.jobAdminMeta.get('job-1')!;
    const original = { ...meta };
    try {
      render(
        <AdminProvider>
          <JobReviewPanel jobId="job-1" />
        </AdminProvider>,
      );
      await screen.findByRole('switch', { name: 'Featured' });

      // What they DO is stated in the UI.
      expect(screen.getByText(/show a badge in search results/i)).toBeInTheDocument();

      const featured = screen.getByRole('switch', { name: 'Featured' });
      const urgent = screen.getByRole('switch', { name: 'Urgent' });
      expect(featured).toHaveAttribute('aria-checked', 'true'); // seeded
      expect(urgent).toHaveAttribute('aria-checked', 'false');

      await user.click(urgent);
      // Persisted (the mock store flipped) and reflected after refetch.
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: 'Urgent' })).toHaveAttribute(
          'aria-checked',
          'true',
        ),
      );
      expect(db.jobAdminMeta.get('job-1')!.isUrgent).toBe(true);
    } finally {
      db.jobAdminMeta.set('job-1', original);
    }
  });

  it('an illegal transition (409) renders as a CALM state, not an error', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    // job-pending-review is PENDING_REVIEW — pausing it is illegal (ACTIVE only).
    render(
      <AdminProvider>
        <JobReviewPanel jobId="job-pending-review" />
      </AdminProvider>,
    );
    await screen.findByText('Site Supervisor (Awaiting Review)');

    await user.click(screen.getByRole('button', { name: 'Pause job' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pause job' }));

    // role="status", calm copy — NOT role="alert".
    const note = await screen.findByText(/already in that state/i);
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(db.jobs.get('job-pending-review')!.status).toBe('PENDING_REVIEW');
  });
});

// ─── Permission gating ───────────────────────────────────────────────────────

describe('permission gating (jobs.view without jobs.moderate)', () => {
  it('SUPPORT sees the panel but NO approve/reject, NO flags, NO lifecycle', async () => {
    signInAs(SUPPORT_USER_ID); // jobs.view ON, jobs.moderate OFF in the seeded matrix
    render(
      <AdminProvider>
        <PermsReady />
        <JobReviewPanel jobId="job-pending-review" />
      </AdminProvider>,
    );
    await screen.findByTestId('perms-ready');
    await screen.findByText('Site Supervisor (Awaiting Review)');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Featured' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause job' })).not.toBeInTheDocument();
  });
});

// ─── On-behalf posting ───────────────────────────────────────────────────────

describe('OnBehalfJobForm', () => {
  it('the worker-protection benefits are LOCKED ON — no admin bypass', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <OnBehalfJobForm />
      </AdminProvider>,
    );
    // The reused S2-F4 BenefitsSection renders the three locked checkboxes.
    const locked = await screen.findAllByRole('checkbox', {
      name: /required by platform policy, cannot be turned off/i,
    });
    expect(locked).toHaveLength(3);
    locked.forEach((c) => {
      expect(c).toHaveAttribute('aria-checked', 'true');
      expect(c).toHaveAttribute('aria-disabled', 'true');
    });
    // The same-gates statement is on the form.
    expect(screen.getByText(/same gates as the employer's own publish/i)).toBeInTheDocument();
  });

  it('a publish gate failure renders the SAME explainer + the honest draft note', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // Force rung 1 on publish (the picker only offers APPROVED employers, but
    // the world can change between picking and publishing).
    server.use(
      http.post('/api/v1/admin/jobs', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'The target employer is not approved.',
            code: 'EMPLOYER_NOT_APPROVED',
          },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { container } = render(
      <AdminProvider>
        <OnBehalfJobForm />
      </AdminProvider>,
    );

    // Pick the employer.
    await user.click(await screen.findByRole('button', { name: /gulf builders arabia/i }));

    // Fill the minimum valid form.
    await user.type(screen.getByLabelText(/job title/i), 'Crane Operator');
    // Market defaults to GULF → a GCC country is required to publish.
    await user.selectOptions(
      container.querySelector<HTMLSelectElement>('#ob-job-country')!,
      'United Arab Emirates',
    );
    const categorySelect = container.querySelector<HTMLSelectElement>('#ob-job-category')!;
    await waitFor(() => expect(categorySelect.options.length).toBeGreaterThan(1));
    await user.selectOptions(categorySelect, categorySelect.options[1]!.value);
    await user.type(screen.getByLabelText(/location/i), 'Dubai');
    await user.click(container.querySelector<HTMLTextAreaElement>('#ob-job-description')!);
    await user.paste(LONG_DESCRIPTION);
    await user.type(container.querySelector<HTMLInputElement>('#salary-min')!, '2000');
    await user.type(container.querySelector<HTMLInputElement>('#salary-max')!, '2500');
    // Posting now requires accepting the job-posting terms.
    await user.click(screen.getByRole('checkbox', { name: /accept these terms/i }));

    await user.click(screen.getByRole('button', { name: 'Publish now' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('The employer is no longer approved')).toBeInTheDocument();
    // The create half survived — the admin is told where their work went.
    expect(screen.getByText(/still saved as a draft/i)).toBeInTheDocument();
  });
});

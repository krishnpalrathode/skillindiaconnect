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
  MODERATOR_USER_ID,
  SUPER_ADMIN_USER_ID,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider, useAdmin } from '../../../../lib/admin/admin-context';
import { AdminApplicationsTable } from '../AdminApplicationsTable';
import { ApplicationDetailPanel } from '../ApplicationDetailPanel';

let mockSearch = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/applications',
  useSearchParams: () => mockSearch,
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

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

// ─── The global list ─────────────────────────────────────────────────────────

describe('AdminApplicationsTable', () => {
  it('sends the filters + search to the endpoint and renders admin-context rows', async () => {
    signInAs(ADMIN_USER_ID);
    mockSearch = new URLSearchParams('status=SELECTED&search=AP-2026-3');
    const seen: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/admin/applications')) seen.push(url.searchParams);
    });

    render(
      <AdminProvider>
        <AdminApplicationsTable />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('AP-2026-3')).toBeInTheDocument());
    const params = seen[seen.length - 1]!;
    expect(params.get('status')).toBe('SELECTED');
    expect(params.get('search')).toBe('AP-2026-3');
  });

  it('the override indicator shows on overridden rows — and ONLY on them', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <AdminApplicationsTable />
      </AdminProvider>,
    );
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');

    // app-3's seeded timeline contains an admin override — the chip renders.
    const overridden = rows.find((r) => within(r).queryByText('AP-2026-3'));
    expect(within(overridden!).getByText('Admin override')).toBeInTheDocument();
    // app-1 has only an employer move — no chip.
    const clean = rows.find((r) => within(r).queryByText('AP-2026-1'));
    expect(within(clean!).queryByText('Admin override')).not.toBeInTheDocument();
  });

  it('a MODERATOR (no applications.manage) gets the honest ForbiddenState', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        <AdminApplicationsTable />
      </AdminProvider>,
    );
    await waitFor(() => expect(screen.getByText(/you don't have permission/i)).toBeInTheDocument());
  });
});

// ─── The detail: the FULL record ─────────────────────────────────────────────

describe('ApplicationDetailPanel', () => {
  it('shows the full timeline WITH the override reason, the pairing links, and the WhatsApp receipt state', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-3" />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('AP-2026-3')).toBeInTheDocument());

    // The pairing — both admin views linked.
    expect(screen.getByRole('link', { name: 'Amir Khan' })).toHaveAttribute(
      'href',
      '/en/admin/candidates/mock-user-candidate-1',
    );
    expect(screen.getByRole('link', { name: /housekeeping/i })).toBeInTheDocument();

    // THE RECORD: the override entry carries its reason — admin-only content.
    // (The chip AND the timeline flag both say it — at least both must exist.)
    expect(screen.getAllByText(/admin override/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Candidate reinstated after internal review/)).toBeInTheDocument();
    // The non-override employer moves show their actor role.
    expect(screen.getAllByText(/EMPLOYER ·/).length).toBeGreaterThanOrEqual(1);

    // The notification state: the automated WhatsApp already fired.
    expect(screen.getByText(/^Sent /)).toBeInTheDocument();
  });
});

// ─── The override dialog ─────────────────────────────────────────────────────

describe('OverrideDialog', () => {
  it('blocks without a reason and states the NEUTRAL-entry truth before the admin types', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-1" />
      </AdminProvider>,
    );
    await screen.findByText('AP-2026-1');
    await user.click(screen.getByRole('button', { name: /change status/i }));

    const dialog = await screen.findByRole('dialog');
    // The content requirement, verbatim: where the reason goes, what the candidate sees.
    expect(
      within(dialog).getByText(/recorded in the audit log and shown to other admins/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/candidate sees only a neutral entry/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/'Status updated by SkillIndiaConnect'/)).toBeInTheDocument();

    // Blocked without target + reason.
    const confirm = within(dialog).getByRole('button', { name: 'Change status' });
    expect(confirm).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('New status'), 'REJECTED');
    expect(confirm).toBeDisabled(); // still no reason
    await user.type(within(dialog).getByLabelText('Reason'), 'Employer requested correction.');
    expect(confirm).toBeEnabled();
  });

  it('re-selecting an already-notified application surfaces the "no new WhatsApp" guard note', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    // app-3 has selectedNotifiedAt set; move it out of SELECTED first so
    // "Selected" is an offerable target.
    const app = db.applications.get('app-3')!;
    const originalStatus = app.status;
    app.status = 'REJECTED';
    try {
      render(
        <AdminProvider>
          <ApplicationDetailPanel applicationId="app-3" />
        </AdminProvider>,
      );
      await screen.findByText('AP-2026-3');
      await user.click(screen.getByRole('button', { name: /change status/i }));

      const dialog = await screen.findByRole('dialog');
      // Not shown until the target is Selected…
      expect(within(dialog).queryByText(/will not send a new one/i)).not.toBeInTheDocument();
      await user.selectOptions(within(dialog).getByLabelText('New status'), 'SELECTED');
      // …then the guard is made legible, pointing at the manual resend.
      expect(
        within(dialog).getByText(/moving them to Selected again will NOT send a new one/i),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/use the manual WhatsApp resend/i)).toBeInTheDocument();
    } finally {
      app.status = originalStatus;
    }
  });

  it('confirm PATCHes the override and the refetched timeline shows the new entry', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    const app = db.applications.get('app-1')!;
    const originalStatus = app.status;
    const originalTimeline = [...(db.applicationTimeline.get('app-1') ?? [])];
    try {
      render(
        <AdminProvider>
          <ApplicationDetailPanel applicationId="app-1" />
        </AdminProvider>,
      );
      await screen.findByText('AP-2026-1');
      await user.click(screen.getByRole('button', { name: /change status/i }));

      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('New status'), 'REJECTED');
      await user.type(within(dialog).getByLabelText('Reason'), 'Wrong shortlist — correcting.');
      await user.click(within(dialog).getByRole('button', { name: 'Change status' }));

      // Refetch (not optimistic): the record now shows the override + reason.
      await waitFor(() =>
        expect(screen.getByText(/Wrong shortlist — correcting\./)).toBeInTheDocument(),
      );
      expect(db.applications.get('app-1')!.status).toBe('REJECTED');
    } finally {
      app.status = originalStatus;
      app.overrideReason = null;
      db.applicationTimeline.set('app-1', originalTimeline);
    }
  });
});

// ─── Notes ───────────────────────────────────────────────────────────────────

describe('NotesPanel', () => {
  it('is labeled INTERNAL-ONLY and add/delete round-trip', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    const originalNotes = [...(db.applicationNotes.get('app-3') ?? [])];
    try {
      render(
        <AdminProvider>
          <ApplicationDetailPanel applicationId="app-3" />
        </AdminProvider>,
      );
      await screen.findByText('AP-2026-3');

      // The unmissable label — and it's part of the panel's description.
      const label = screen.getByText('Internal — never shown to the candidate or employer.');
      expect(label).toBeInTheDocument();
      expect(label.closest('section')).toHaveAttribute('aria-describedby', 'notes-internal-label');

      // Add (with the live counter).
      await user.type(
        screen.getByPlaceholderText(/add a note for the admin team/i),
        'Called the candidate to confirm.',
      );
      expect(screen.getByText(/32 \/ 2000/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add note' }));
      await waitFor(() =>
        expect(screen.getByText('Called the candidate to confirm.')).toBeInTheDocument(),
      );

      // Delete it again (SUPER_ADMIN may delete any note).
      const noteRow = screen.getByText('Called the candidate to confirm.').closest('li')!;
      await user.click(within(noteRow).getByRole('button', { name: /delete note/i }));
      await waitFor(() =>
        expect(screen.queryByText('Called the candidate to confirm.')).not.toBeInTheDocument(),
      );
    } finally {
      db.applicationNotes.set('app-3', originalNotes);
    }
  });
});

// ─── The resend ──────────────────────────────────────────────────────────────

describe('ResendWhatsAppDialog', () => {
  it('is offered ONLY on SELECTED applications', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    // app-1 is SHORTLISTED — no resend button.
    const { unmount } = render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-1" />
      </AdminProvider>,
    );
    await screen.findByText('AP-2026-1');
    expect(screen.getByRole('button', { name: /change status/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend whatsapp/i })).not.toBeInTheDocument();
    unmount();

    // app-3 is SELECTED — offered.
    render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-3" />
      </AdminProvider>,
    );
    await screen.findByText('AP-2026-3');
    expect(screen.getByRole('button', { name: /resend whatsapp/i })).toBeInTheDocument();
  });

  it('mandatory reason + the consequence + the original-date truth; success states the queueing', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();
    const originalResends = db.whatsappResends.get('app-3');
    try {
      render(
        <AdminProvider>
          <ApplicationDetailPanel applicationId="app-3" />
        </AdminProvider>,
      );
      await screen.findByText('AP-2026-3');
      await user.click(screen.getByRole('button', { name: /resend whatsapp/i }));

      const dialog = await screen.findByRole('dialog');
      // The consequence, plainly.
      expect(
        within(dialog).getByText(/this sends a whatsapp message to amir khan's phone/i),
      ).toBeInTheDocument();
      // The truth about history.
      expect(
        within(dialog).getByText(/original notification date won't change/i),
      ).toBeInTheDocument();

      const confirm = within(dialog).getByRole('button', { name: 'Send WhatsApp' });
      expect(confirm).toBeDisabled(); // reason is mandatory
      await user.type(within(dialog).getByLabelText('Reason'), 'Candidate reported non-delivery.');
      await user.click(confirm);

      await waitFor(() => expect(screen.getByText(/queued for delivery/i)).toBeInTheDocument());
    } finally {
      if (originalResends) db.whatsappResends.set('app-3', originalResends);
      else db.whatsappResends.delete('app-3');
    }
  });

  it('429 renders CALMLY (the guardrail working), and the email fallback is stated honestly', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const user = userEvent.setup();

    // 429 first.
    server.use(
      http.post('/api/v1/admin/applications/:id/resend-whatsapp', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Too Many Requests',
            status: 429,
            detail: 'This application has reached its resend limit. Try again later.',
            code: 'RATE_LIMITED',
          },
          { status: 429 },
        ),
      ),
    );
    const { unmount } = render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-3" />
      </AdminProvider>,
    );
    await screen.findByText('AP-2026-3');
    await user.click(screen.getByRole('button', { name: /resend whatsapp/i }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Send WhatsApp' }));

    const limitNote = await screen.findByText(/reached the resend limit for this application/i);
    // Calm: a status region, NOT an alert.
    expect(limitNote.closest('[role="status"]')).not.toBeNull();
    expect(limitNote.closest('[role="alert"]')).toBeNull();
    unmount();

    // Then the honest fallback.
    server.use(
      http.post('/api/v1/admin/applications/:id/resend-whatsapp', () =>
        HttpResponse.json(
          { data: { resentAt: new Date().toISOString(), channel: 'email_fallback' } },
          { status: 202 },
        ),
      ),
    );
    render(
      <AdminProvider>
        <ApplicationDetailPanel applicationId="app-3" />
      </AdminProvider>,
    );
    await screen.findByText('AP-2026-3');
    await user.click(screen.getByRole('button', { name: /resend whatsapp/i }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Send WhatsApp' }));

    expect(
      await screen.findByText(/can't receive whatsapp — an email was sent instead/i),
    ).toBeInTheDocument();
  });
});

// ─── Per-action permission gating ────────────────────────────────────────────

describe('permission gating', () => {
  it('applications.manage WITHOUT change_status/notes → detail renders, but NO override, NO resend, NO notes', async () => {
    // The seeded roles hold either everything or nothing here, so gate the
    // CONTEXT directly: the data fetch stays authorized (SUPER_ADMIN token),
    // while /admin/me/permissions answers with the reduced grant set the
    // PermissionGates render from.
    signInAs(SUPER_ADMIN_USER_ID);
    server.use(
      http.get('/api/v1/admin/me/permissions', () =>
        HttpResponse.json({
          data: { role: 'ADMIN', permissions: ['applications.manage'] },
        }),
      ),
    );

    render(
      <AdminProvider>
        <PermsReady />
        <ApplicationDetailPanel applicationId="app-3" />
      </AdminProvider>,
    );
    await screen.findByTestId('perms-ready');
    await screen.findByText('AP-2026-3');

    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend whatsapp/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Internal — never shown to the candidate or employer.'),
    ).not.toBeInTheDocument();
  });
});

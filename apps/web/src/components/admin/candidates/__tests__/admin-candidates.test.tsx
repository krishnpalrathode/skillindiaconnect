import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
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
  PURGEABLE_CANDIDATE_USER_ID,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider, useAdmin } from '../../../../lib/admin/admin-context';
import { CandidateTable } from '../CandidateTable';
import { AdminCandidateProfile } from '../AdminCandidateProfile';
import { PurgeDialog } from '../PurgeDialog';

let mockSearch = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/candidates',
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
  vi.unstubAllGlobals();
});

// ─── The structural privacy assertion ────────────────────────────────────────

describe('constraint 2 — separate admin components (structural)', () => {
  it('no admin candidate component imports the S3-F2 employer-context components', () => {
    const dir = path.resolve(__dirname, '..');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      // Strip comments — the assertion targets CODE (imports/props), and the
      // docblocks legitimately DESCRIBE the forbidden pattern.
      const source = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      // The employer-context (absence-aware) components live under
      // components/employer — an import from there is the boundary breach this
      // unit exists to prevent (as is any isAdmin prop on those components).
      expect(source, `${file} must not import employer-context components`).not.toMatch(
        /components\/employer/,
      );
      expect(source, `${file} must not smuggle an isAdmin flag`).not.toMatch(/isAdmin/);
    }
  });
});

// ─── The list ────────────────────────────────────────────────────────────────

describe('CandidateTable', () => {
  it('renders rows with contact details and sends filters + search to the endpoint', async () => {
    signInAs(ADMIN_USER_ID);
    mockSearch = new URLSearchParams('status=SUSPENDED&search=deepak');
    const seen: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/admin/candidates')) seen.push(url.searchParams);
    });

    render(
      <AdminProvider>
        <CandidateTable />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('Deepak Verma')).toBeInTheDocument());
    // The admin sees the phone — the deliberate relaxation.
    expect(screen.getByText('+919811112222')).toBeInTheDocument();
    const params = seen[seen.length - 1]!;
    expect(params.get('status')).toBe('SUSPENDED');
    expect(params.get('search')).toBe('deepak');
  });

  it('a pending-deletion row shows the countdown', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <CandidateTable />
      </AdminProvider>,
    );
    await waitFor(() => expect(screen.getByText('Sunita Devi')).toBeInTheDocument());
    expect(screen.getByText(/auto-purges in 12 days/i)).toBeInTheDocument();
  });

  it('a PURGED row is a tombstone: "Deleted user", no contact, and NO actions', async () => {
    signInAs(ADMIN_USER_ID);
    // Mimic the purge handler's tombstone effect on a throwaway fixture state.
    const candidate = db.candidates.get(PURGEABLE_CANDIDATE_USER_ID)!;
    const original = { fullName: candidate.profile.fullName, phone: candidate.profile.phone };
    candidate.profile.fullName = 'Deleted user';
    candidate.profile.phone = undefined;
    db.candidateLifecycle.set(PURGEABLE_CANDIDATE_USER_ID, {
      deletionDueAt: null,
      purgedAt: new Date().toISOString(),
    });

    try {
      render(
        <AdminProvider>
          <CandidateTable />
        </AdminProvider>,
      );

      const table = await screen.findByRole('table');
      const row = within(table).getByText('Deleted user').closest('tr')!;
      expect(within(row).getByText('Purged')).toBeInTheDocument();
      // NOTHING left to do to a tombstone: no view link, no buttons.
      expect(within(row).queryByRole('link')).not.toBeInTheDocument();
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    } finally {
      candidate.profile.fullName = original.fullName;
      candidate.profile.phone = original.phone;
      db.candidateLifecycle.delete(PURGEABLE_CANDIDATE_USER_ID);
    }
  });
});

// ─── The detail ──────────────────────────────────────────────────────────────

describe('AdminCandidateProfile', () => {
  it('renders phone + email (the audited relaxation) with the honest admin-view note', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );

    await screen.findByRole('heading', { name: 'Vikram Singh' });
    expect(screen.getByText('+919812345678')).toBeInTheDocument();
    expect(screen.getByText('purgeable@example.com')).toBeInTheDocument();
    // Factual, quiet — not a warning banner.
    expect(
      screen.getByText(/you can see contact details this candidate has hidden/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/document access is logged/i)).toBeInTheDocument();
  });

  it('gating: ADMIN sees Suspend but NO danger zone; SUPER_ADMIN sees the danger zone', async () => {
    signInAs(ADMIN_USER_ID); // candidates.edit ON, candidates.delete OFF (the seed)
    const first = render(
      <AdminProvider>
        <PermsReady />
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await screen.findByTestId('perms-ready');
    expect(screen.getByRole('button', { name: /suspend account/i })).toBeInTheDocument();
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /purge/i })).not.toBeInTheDocument();
    first.unmount();
    resetClient();

    signInAs(SUPER_ADMIN_USER_ID);
    render(
      <AdminProvider>
        <PermsReady />
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await screen.findByTestId('perms-ready');
    expect(screen.getByText(/danger zone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /purge this account/i })).toBeInTheDocument();
  });

  it('a MODERATOR (candidates.view without candidates.edit) sees NO Suspend at all', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        <PermsReady />
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await screen.findByTestId('perms-ready');
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });

  it('suspend requires a reason, names the consequence, and round-trips', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await userEvent.click(screen.getByRole('button', { name: /suspend account/i }));

    const dialog = await screen.findByRole('dialog');
    // The consequence, in plain words.
    expect(dialog).toHaveTextContent(/unable to log in and will not appear to employers/i);

    // Confirm without a reason → blocked client-side, dialog stays.
    await userEvent.click(within(dialog).getByRole('button', { name: /^suspend account$/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/reason is required/i);

    await userEvent.type(
      within(dialog).getByLabelText(/reason for suspension/i),
      'Forged certificates reported',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /^suspend account$/i }));

    // Refetched (never optimistic): the badge shows the server's new truth.
    await waitFor(() => expect(screen.getByText('Suspended')).toBeInTheDocument());
    // Restore the shared fixture for later tests.
    const user = db.users.get(PURGEABLE_CANDIDATE_USER_ID)!;
    user.status = 'ACTIVE';
  });

  it('the purge POST carries { reason, confirm: true }; the tombstone renders after', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/purge')) {
        void request
          .clone()
          .json()
          .then((b) => bodies.push(b));
      }
    });

    const candidate = db.candidates.get(PURGEABLE_CANDIDATE_USER_ID)!;
    const original = {
      fullName: candidate.profile.fullName,
      phone: candidate.profile.phone,
      email: candidate.profile.email,
      documents: candidate.profile.documents,
      profileVisible: candidate.profile.profileVisible,
    };
    const originalUser = { ...db.users.get(PURGEABLE_CANDIDATE_USER_ID)! };

    try {
      render(
        <AdminProvider>
          <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
        </AdminProvider>,
      );
      await screen.findByRole('heading', { name: 'Vikram Singh' });
      await userEvent.click(await screen.findByRole('button', { name: /purge this account/i }));

      const dialog = await screen.findByRole('alertdialog');
      await userEvent.type(
        within(dialog).getByLabelText(/reason for purging/i),
        'Erasure request #42',
      );
      await userEvent.type(
        within(dialog).getByLabelText(/type the candidate's full name/i),
        'Vikram Singh',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: /purge permanently/i }));

      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toEqual({ reason: 'Erasure request #42', confirm: true });

      // The refetched detail is the tombstone.
      await screen.findByRole('heading', { name: 'Deleted user' });
      expect(screen.getByText(/this account was purged on/i)).toBeInTheDocument();
      expect(screen.getByText(/purge started/i)).toBeInTheDocument();
      // The danger zone is gone — nothing left to destroy.
      expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
      // Documents were destroyed — the honest empty state.
      expect(screen.getByText(/documents were destroyed/i)).toBeInTheDocument();
    } finally {
      Object.assign(candidate.profile, original);
      db.users.set(PURGEABLE_CANDIDATE_USER_ID, originalUser);
      db.candidateLifecycle.delete(PURGEABLE_CANDIDATE_USER_ID);
    }
  });

  it('409 CANDIDATE_ALREADY_PURGED renders calmly (refetch, no crash)', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    server.use(
      http.post('/api/v1/admin/candidates/:id/purge', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'This candidate has already been purged.',
            code: 'CANDIDATE_ALREADY_PURGED',
          },
          { status: 409 },
        ),
      ),
    );

    render(
      <AdminProvider>
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await userEvent.click(await screen.findByRole('button', { name: /purge this account/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/reason for purging/i), 'x');
    await userEvent.type(
      within(dialog).getByLabelText(/type the candidate's full name/i),
      'Vikram Singh',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /purge permanently/i }));

    // The guard worked: the dialog closes and the screen re-renders the truth.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Vikram Singh' })).toBeInTheDocument();
  });
});

// ─── The gravity dialog in isolation ─────────────────────────────────────────

describe('PurgeDialog — type-to-confirm gating', () => {
  const renderDialog = () => {
    const onConfirm = vi.fn();
    render(
      <PurgeDialog
        candidateName="Vikram Singh"
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    return {
      onConfirm,
      confirm: () => screen.getByRole('button', { name: /purge permanently/i }),
      reason: () => screen.getByLabelText(/reason for purging/i),
      typed: () => screen.getByLabelText(/type the candidate's full name/i),
    };
  };

  it('announces as an alertdialog and states destroyed + survives + irreversible', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    // What is destroyed — enumerated plainly.
    expect(dialog).toHaveTextContent(/name, phone, email, date of birth, photo/i);
    expect(dialog).toHaveTextContent(/all uploaded documents/i);
    expect(dialog).toHaveTextContent(/files are removed from storage/i);
    // What survives — the anonymized applications and the audit record.
    expect(dialog).toHaveTextContent(/applications remain as anonymous records/i);
    expect(dialog).toHaveTextContent(/audit log records that this account existed/i);
    // Irreversibility, once, prominently.
    expect(dialog).toHaveTextContent(/this cannot be undone/i);
    // The expected value is stated in TEXT, not only a placeholder.
    expect(dialog).toHaveTextContent(/type exactly: vikram singh/i);
  });

  it('stays disabled: initially, with reason only, and with the name only', async () => {
    const d = renderDialog();
    expect(d.confirm()).toBeDisabled();

    await userEvent.type(d.reason(), 'a valid reason');
    expect(d.confirm()).toBeDisabled(); // reason alone is not consent

    await userEvent.clear(d.reason());
    await userEvent.type(d.typed(), 'Vikram Singh');
    expect(d.confirm()).toBeDisabled(); // the name alone is not accountability
  });

  it('a near-miss (wrong case / partial) keeps it disabled; the exact match enables', async () => {
    const d = renderDialog();
    await userEvent.type(d.reason(), 'erasure request');

    await userEvent.type(d.typed(), 'vikram singh'); // wrong case
    expect(d.confirm()).toBeDisabled();
    await userEvent.clear(d.typed());
    await userEvent.type(d.typed(), 'Vikram'); // partial
    expect(d.confirm()).toBeDisabled();
    // The disabled-reason is conveyed in text for AT users.
    expect(screen.getByText(/stays disabled until you type/i)).toBeInTheDocument();

    await userEvent.clear(d.typed());
    await userEvent.type(d.typed(), 'Vikram Singh'); // exact
    expect(d.confirm()).toBeEnabled();

    await userEvent.click(d.confirm());
    expect(d.onConfirm).toHaveBeenCalledWith('erasure request');
  });
});

// ─── The audited document list ───────────────────────────────────────────────

describe('AdminDocumentList (via the detail)', () => {
  it('View mints the signed URL and opens it in a new tab; the logged note is present', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    const open = vi.fn();
    vi.stubGlobal('open', open);

    render(
      <AdminProvider>
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    expect(screen.getByText(/document views are logged/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /view passport/i }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const [url, target, features] = open.mock.calls[0]!;
    expect(String(url)).toContain('sig=mock');
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
  });

  it('a failed/expired grant shows the refresh-link affordance', async () => {
    signInAs(SUPER_ADMIN_USER_ID);
    vi.stubGlobal('open', vi.fn());
    server.use(
      http.get('/api/v1/admin/candidates/:id/documents/:type/url', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, detail: 'x', code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    );

    render(
      <AdminProvider>
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await userEvent.click(screen.getByRole('button', { name: /view passport/i }));
    expect(await screen.findByRole('button', { name: /refresh link/i })).toBeInTheDocument();
  });

  it('a MODERATOR (no candidates.view_documents) sees NO View buttons', async () => {
    signInAs(MODERATOR_USER_ID);
    render(
      <AdminProvider>
        <PermsReady />
        <AdminCandidateProfile candidateId={PURGEABLE_CANDIDATE_USER_ID} />
      </AdminProvider>,
    );
    await screen.findByRole('heading', { name: 'Vikram Singh' });
    await screen.findByTestId('perms-ready');
    // The document row exists (status is candidates.view) — the audited View does not.
    expect(screen.getByText('Passport')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view passport/i })).not.toBeInTheDocument();
  });
});

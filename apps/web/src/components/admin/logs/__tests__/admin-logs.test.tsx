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
  LOGS_EXPORT_MAX_ROWS,
  LOGS_EXPORT_MAX_RANGE_DAYS,
} from '../../../../mocks/data';
import { setAccessToken, resetClient } from '../../../../lib/api/client';
import { AdminProvider, useAdmin } from '../../../../lib/admin/admin-context';
import AdminLogsPage from '../../../../app/[locale]/admin/logs/page';
import { ExportButton } from '../ExportButton';
import { LogMetaViewer } from '../LogMetaViewer';

let mockSearch = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/admin/logs',
  useSearchParams: () => mockSearch,
}));

function signInAs(userId: string) {
  const token = makeAccessToken(userId);
  db.sessions.set(token, { userId, accessToken: token });
  setAccessToken(token);
}

/** Requests the page actually sent — for asserting filter → param wiring. */
function captureLogRequests(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/admin/logs')) seen.push(url.searchParams);
  });
  return seen;
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

describe('Screen 29 — filters and the keyset walk', () => {
  it('renders rows and the DEFAULT-WINDOW disclosure when no date range is set', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <AdminLogsPage />
      </AdminProvider>,
    );

    // Rows arrive (the fixture spans the taxonomy).
    await waitFor(() => expect(screen.getByText('job.publish.blocked')).toBeInTheDocument());
    // THE disclosure: without it, an admin concludes older logs don't exist.
    expect(screen.getByText(/showing the last 30 days/i)).toBeInTheDocument();
    // Keyset presentation: no page numbers anywhere.
    expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
  });

  it('module chip + status select hit the endpoint with the right params (URL-synced)', async () => {
    signInAs(ADMIN_USER_ID);
    // The page reads filters from the URL; simulate the shareable investigation
    // link directly (the chips write the same URL via history.replaceState).
    mockSearch = new URLSearchParams('module=Jobs&status=BLOCKED');
    const requests = captureLogRequests();

    render(
      <AdminProvider>
        <AdminLogsPage />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('job.publish.blocked')).toBeInTheDocument());
    const params = requests[requests.length - 1]!;
    expect(params.get('module')).toBe('Jobs');
    expect(params.get('status')).toBe('BLOCKED');
    // Only the matching row renders.
    expect(screen.queryByText('employer.approved')).not.toBeInTheDocument();
  });

  it('keyset Load more appends WITHOUT duplicates and ends cleanly', async () => {
    signInAs(ADMIN_USER_ID);
    mockSearch = new URLSearchParams('limit=2'); // not a real filter — ignored by the page
    signInAs(ADMIN_USER_ID);

    // Force small pages by overriding the handler's limit via a wrapper: the
    // page doesn't set limit, so drive paging through a patched handler that
    // returns 2 rows per cursor from the real fixture.
    const all = db.auditLogs.slice();
    server.use(
      http.get('/api/v1/admin/logs', ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
        const page = all.slice(start, start + 2);
        const nextCursor = start + 2 < all.length ? (page[page.length - 1]?.id ?? null) : null;
        return HttpResponse.json({ data: page, nextCursor });
      }),
    );

    render(
      <AdminProvider>
        <AdminLogsPage />
      </AdminProvider>,
    );

    const loadMore = await screen.findByRole('button', { name: /load more/i });
    // Walk every page.
    for (let guard = 0; guard < 20; guard++) {
      if (screen.queryByRole('button', { name: /load more/i }) === null) break;
      await userEvent.click(screen.getByRole('button', { name: /load more/i }));
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /load more/i })?.hasAttribute('disabled') ?? false,
        ).toBe(false),
      );
    }
    expect(loadMore).not.toBeInTheDocument();

    // Every fixture row exactly once — no skips, no duplicates.
    const table = screen.getByRole('table');
    for (const row of all) {
      expect(within(table).getAllByText(row.action).length).toBeGreaterThanOrEqual(1);
    }
    const bodyRows = within(table)
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('columnheader').length === 0);
    expect(bodyRows).toHaveLength(all.length);
    // And the honest terminus.
    expect(screen.getByText(/end of results/i)).toBeInTheDocument();
  });

  it('expanding a row shows the meta AS STORED (no client-side redaction pass)', async () => {
    signInAs(ADMIN_USER_ID);
    mockSearch = new URLSearchParams('module=Jobs&status=BLOCKED');
    render(
      <AdminProvider>
        <AdminLogsPage />
      </AdminProvider>,
    );

    await waitFor(() => expect(screen.getByText('job.publish.blocked')).toBeInTheDocument());
    await userEvent.click(
      screen.getByRole('button', { name: /show details for job\.publish\.blocked/i }),
    );

    // The fixture meta rendered verbatim — the server's redaction is the only pass.
    expect(screen.getByText(/failedRules/)).toBeInTheDocument();
    expect(screen.getByText(/accommodation/)).toBeInTheDocument();
    // Labeled as write-time-redacted details, never as "raw" data.
    expect(screen.getByText(/sensitive fields removed at write time/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw/i)).not.toBeInTheDocument();
  });
});

describe('LogMetaViewer', () => {
  it('renders empty meta honestly', () => {
    render(<LogMetaViewer meta={{}} />);
    expect(screen.getByText(/no additional details/i)).toBeInTheDocument();
  });
});

describe('ExportButton — gated, filter-explicit, cap-aware', () => {
  it('a MODERATOR (logs.view without logs.export) sees NO export button at all', async () => {
    signInAs(MODERATOR_USER_ID);
    // A probe that signals when the permission fetch has settled, so the
    // absence below is asserted AFTER the gate had every chance to render.
    function PermsReady() {
      const { isLoading } = useAdmin();
      return isLoading ? null : <span data-testid="perms-ready" />;
    }
    render(
      <AdminProvider>
        <PermsReady />
        <ExportButton query={{}} approximateCount={4} />
      </AdminProvider>,
    );
    await screen.findByTestId('perms-ready');
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('an ADMIN sees it, filter-explicit, with the self-audit note', async () => {
    signInAs(ADMIN_USER_ID);
    render(
      <AdminProvider>
        <ExportButton query={{ module: 'Jobs' }} approximateCount={7} />
      </AdminProvider>,
    );

    const button = await screen.findByRole('button', { name: /export these 7\+ results/i });
    expect(button).toHaveTextContent(/current filters/i);
    expect(screen.getByText(/exports are themselves recorded/i)).toBeInTheDocument();
  });

  it('EXPORT_TOO_LARGE → the actionable narrow-your-filters state with the server caps', async () => {
    signInAs(ADMIN_USER_ID);
    server.use(
      http.get('/api/v1/admin/logs/export', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unprocessable',
            status: 422,
            detail: 'Export too large.',
            code: 'EXPORT_TOO_LARGE',
            meta: { maxRows: LOGS_EXPORT_MAX_ROWS, maxRangeDays: LOGS_EXPORT_MAX_RANGE_DAYS },
          },
          { status: 422 },
        ),
      ),
    );

    render(
      <AdminProvider>
        <ExportButton query={{}} approximateCount={50} />
      </AdminProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /export these/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/narrow the date range or add filters/i);
    expect(alert).toHaveTextContent(String(LOGS_EXPORT_MAX_ROWS));
    expect(alert).toHaveTextContent(String(LOGS_EXPORT_MAX_RANGE_DAYS));
  });
});

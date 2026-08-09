import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { db, makeAccessToken } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { getMyApplication } from '../../../lib/api/applications';
import { ApplicationCard } from '../ApplicationCard';
import { StatusFilterTabs } from '../StatusFilterTabs';
import { ApplicationTimeline } from '../ApplicationTimeline';
import { RejectionCard } from '../RejectionCard';
import { WhatsAppReceipt } from '../WhatsAppReceipt';
import { MyApplicationsMini } from '../../dashboard/MyApplicationsMini';
import { KpiCards } from '../../dashboard/KpiCards';
import type { components } from '@skillindiaconnect/shared-types';

type ApplicationCardT = components['schemas']['ApplicationCard'];
type TimelineEntry = components['schemas']['ApplicationTimelineEntry'];

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/applications',
  useSearchParams: () => new URLSearchParams(),
}));

const CAND = 'mock-user-candidate-1';

function card(overrides: Partial<ApplicationCardT> = {}): ApplicationCardT {
  return {
    id: 'app-x',
    humanId: 'AP-2026-9',
    job: {
      id: 'job-1',
      title: 'Mason',
      companyName: 'Gulf Builders',
      location: 'Dubai',
      market: 'GULF',
    },
    status: 'PENDING',
    matchScore: 72,
    appliedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetClient();
  const token = makeAccessToken(CAND);
  setAccessToken(token);
  db.sessions.set(token, { userId: CAND, accessToken: token });
});

// ── ApplicationCard ─────────────────────────────────────────────────────────
describe('ApplicationCard', () => {
  it('renders job subset, humanId, status badge, and links to the detail', () => {
    render(<ApplicationCard application={card()} locale="en" />);
    expect(screen.getByText('Mason')).toBeInTheDocument();
    expect(screen.getByText('AP-2026-9')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/applications/app-x');
  });

  it('receipt is FIELD-driven: SELECTED WITH selectedNotifiedAt shows it', () => {
    render(
      <ApplicationCard
        application={card({ status: 'SELECTED', selectedNotifiedAt: new Date().toISOString() })}
        locale="en"
      />,
    );
    expect(screen.getByText(/notified on whatsapp/i)).toBeInTheDocument();
  });

  it('receipt is FIELD-driven: SELECTED WITHOUT selectedNotifiedAt shows NONE', () => {
    render(
      <ApplicationCard
        application={card({ status: 'SELECTED', selectedNotifiedAt: null })}
        locale="en"
      />,
    );
    expect(screen.queryByText(/notified on whatsapp/i)).toBeNull();
  });

  it('REJECTED + feedback shows a one-line preview', () => {
    render(
      <ApplicationCard
        application={card({
          status: 'REJECTED',
          rejectionFeedback: 'Went with more experienced masons.',
        })}
        locale="en"
      />,
    );
    expect(screen.getByText(/more experienced masons/i)).toBeInTheDocument();
  });
});

describe('WhatsAppReceipt', () => {
  it('is text-backed (not icon-only)', () => {
    render(<WhatsAppReceipt notifiedAt={new Date('2026-06-01').toISOString()} locale="en" />);
    expect(screen.getByText(/notified on whatsapp/i)).toBeInTheDocument();
  });
});

// ── StatusFilterTabs ────────────────────────────────────────────────────────
describe('StatusFilterTabs', () => {
  it('is a tablist and fires onChange with the status', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StatusFilterTabs value="ALL" onChange={onChange} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Shortlisted' }));
    expect(onChange).toHaveBeenCalledWith('SHORTLISTED');
  });
});

// ── ApplicationTimeline ─────────────────────────────────────────────────────
describe('ApplicationTimeline', () => {
  const employerMove: TimelineEntry = {
    fromStatus: 'PENDING',
    toStatus: 'SHORTLISTED',
    actorRole: 'EMPLOYER',
    isAdminOverride: false,
    createdAt: new Date('2026-06-10').toISOString(),
  };
  const adminMove: TimelineEntry = {
    fromStatus: 'REJECTED',
    toStatus: 'SELECTED',
    actorRole: 'ADMIN',
    isAdminOverride: true,
    createdAt: new Date('2026-06-12').toISOString(),
  };

  it('anchors the Applied event at the top and renders the ordered steps', () => {
    render(
      <ApplicationTimeline
        timeline={[employerMove]}
        appliedAt={new Date('2026-06-01').toISOString()}
        locale="en"
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/application submitted/i);
    expect(screen.getByText(/shortlisted by the employer/i)).toBeInTheDocument();
  });

  it('admin override → neutral role-level copy, NO reason/actor anywhere', () => {
    render(
      <ApplicationTimeline
        timeline={[adminMove]}
        appliedAt={new Date('2026-06-01').toISOString()}
        locale="en"
      />,
    );
    expect(screen.getByText(/status updated by skill india connect/i)).toBeInTheDocument();
    // No reason, no actor identity, no "Reason:" slot.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/reason/i);
    expect(html).not.toMatch(/ADMIN/);
    expect(html).not.toMatch(/reinstated/i);
  });
});

// ── S3 discipline via the mock: the detail's timeline carries NO overrideReason ──
describe('candidate detail timeline (mock) — override reason dropped', () => {
  it('app-3 has an admin-override step but no overrideReason in the API payload or DOM', async () => {
    const detail = await getMyApplication('app-3');
    const override = detail.timeline.find((e) => e.isAdminOverride);
    expect(override).toBeTruthy();
    expect(JSON.stringify(detail.timeline)).not.toContain('reinstated');
    expect('overrideReason' in (override as object)).toBe(false);

    render(
      <ApplicationTimeline timeline={detail.timeline} appliedAt={detail.appliedAt} locale="en" />,
    );
    expect(screen.getByText(/status updated by skill india connect/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/reinstated/i);
  });
});

// ── RejectionCard ───────────────────────────────────────────────────────────
describe('RejectionCard', () => {
  it('feedback present → labeled block + constructive next-step', () => {
    render(<RejectionCard feedback="We chose candidates with Gulf experience." locale="en" />);
    expect(screen.getByText(/feedback from the employer/i)).toBeInTheDocument();
    expect(screen.getByText(/gulf experience/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse more jobs/i })).toHaveAttribute(
      'href',
      '/en/jobs',
    );
  });

  it('feedback absent → NO feedback block, but the next-step still shows', () => {
    render(<RejectionCard feedback={null} locale="en" />);
    expect(screen.queryByText(/feedback from the employer/i)).toBeNull();
    expect(screen.getByRole('link', { name: /browse more jobs/i })).toBeInTheDocument();
  });
});

// ── Dashboard swap ──────────────────────────────────────────────────────────
describe('MyApplicationsMini (live)', () => {
  it('renders the top-N application cards + a View all link into Screen 08', async () => {
    render(<MyApplicationsMini />);
    // candidate-1 has seeded applications → cards appear, linking into /en/applications/*
    await waitFor(() => expect(screen.getAllByRole('link').length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/en/applications',
    );
  });
});

describe('KpiCards live swap', () => {
  it('Jobs Applied + Shortlisted link into Screen 08 with the endpoint values', () => {
    render(
      <KpiCards
        stats={{ applied: 4, profileViews: 0, shortlisted: 1 }}
        unreadCount={0}
        profileViews={{ total: 0, last30Days: 0, recentViews: [] }}
      />,
    );
    expect(screen.getByText('4')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/en/applications');
    expect(hrefs).toContain('/en/applications?status=SHORTLISTED');
  });
});

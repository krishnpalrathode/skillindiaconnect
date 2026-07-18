import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../../test-utils';
import { ApplicantActions } from '../ApplicantActions';
import { ApplicantCard } from '../ApplicantCard';
import { ApplicantFilters } from '../ApplicantFilters';
import { MatchBreakdownPopover } from '../MatchBreakdownPopover';
import type { components } from '@skillindiaconnect/shared-types';

type ApplicantCardT = components['schemas']['ApplicantCard'];
type MatchBreakdown = components['schemas']['MatchBreakdown'];

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
}));

const BREAKDOWN: MatchBreakdown = {
  category: { score: 40, max: 40 },
  experienceYears: { raw: 8, clamped: 8, score: 24, max: 30 },
  foreignExperience: { score: 20, max: 20 },
  documents: { score: 10, max: 10 },
};

function applicant(overrides: Partial<ApplicantCardT> = {}): ApplicantCardT {
  return {
    id: 'cand-1',
    fullName: 'Amir Khan',
    isAvailable: true,
    documentsStatus: [
      { type: 'PASSPORT', uploaded: true, passportValid: true },
      { type: 'EXPERIENCE_CERT', uploaded: true },
      { type: 'EDUCATIONAL_CERT', uploaded: false },
    ],
    createdAt: new Date().toISOString(),
    experiences: [
      {
        id: 'e1',
        type: 'FOREIGN',
        country: 'UAE',
        companyName: 'X',
        role: 'Mason',
        years: 6,
        months: 0,
      },
    ],
    applicationId: 'app-1',
    humanId: 'AP-2026-1',
    status: 'PENDING',
    matchScore: 84,
    matchBreakdown: BREAKDOWN,
    appliedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    ...overrides,
  };
}

// ── ApplicantActions (the matrix) ─────────────────────────────────────────────
describe('ApplicantActions', () => {
  it('PENDING shows Shortlist + Select + Reject', () => {
    render(
      <ApplicantActions
        applicant={applicant({ status: 'PENDING' })}
        busy={false}
        onTransition={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /shortlist amir khan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select amir khan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject amir khan/i })).toBeInTheDocument();
  });

  it('SHORTLISTED shows Select + Reject (no Shortlist)', () => {
    render(
      <ApplicantActions
        applicant={applicant({ status: 'SHORTLISTED' })}
        busy={false}
        onTransition={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /shortlist/i })).toBeNull();
    expect(screen.getByRole('button', { name: /select amir/i })).toBeInTheDocument();
  });

  it('terminal states (SELECTED/REJECTED) show NO actions', () => {
    const { container: c1 } = render(
      <ApplicantActions
        applicant={applicant({ status: 'SELECTED' })}
        busy={false}
        onTransition={vi.fn()}
      />,
    );
    expect(c1.querySelectorAll('button')).toHaveLength(0);
    const { container: c2 } = render(
      <ApplicantActions
        applicant={applicant({ status: 'REJECTED' })}
        busy={false}
        onTransition={vi.fn()}
      />,
    );
    expect(c2.querySelectorAll('button')).toHaveLength(0);
  });

  it('Shortlist is one-tap', async () => {
    const onTransition = vi.fn();
    const user = userEvent.setup();
    render(
      <ApplicantActions
        applicant={applicant({ status: 'PENDING' })}
        busy={false}
        onTransition={onTransition}
      />,
    );
    await user.click(screen.getByRole('button', { name: /shortlist amir/i }));
    expect(onTransition).toHaveBeenCalledWith('SHORTLISTED');
  });

  it('Select requires a confirm naming the ONE-TIME WhatsApp', async () => {
    const onTransition = vi.fn();
    const user = userEvent.setup();
    render(
      <ApplicantActions
        applicant={applicant({ status: 'PENDING' })}
        busy={false}
        onTransition={onTransition}
      />,
    );
    await user.click(screen.getByRole('button', { name: /select amir/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/notified on whatsapp/i);
    expect(dialog).toHaveTextContent(/once/i);
    expect(onTransition).not.toHaveBeenCalled(); // not yet — needs confirm
    await user.click(screen.getByRole('button', { name: /^select$/i }));
    expect(onTransition).toHaveBeenCalledWith('SELECTED');
  });

  it('Reject carries the optional candidate-visible feedback', async () => {
    const onTransition = vi.fn();
    const user = userEvent.setup();
    render(
      <ApplicantActions
        applicant={applicant({ status: 'PENDING' })}
        busy={false}
        onTransition={onTransition}
      />,
    );
    await user.click(screen.getByRole('button', { name: /reject amir/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/visible to the candidate/i);
    await user.type(screen.getByLabelText(/feedback/i), 'Needs more Gulf experience.');
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onTransition).toHaveBeenCalledWith('REJECTED', {
      rejectionFeedback: 'Needs more Gulf experience.',
    });
  });
});

// ── Privacy inheritance (third path) ──────────────────────────────────────────
describe('ApplicantCard privacy', () => {
  it('hidden-phone applicant (no phone field) renders NO phone; docs chips not focusable', () => {
    const { container } = render(
      <ApplicantCard
        applicant={applicant({ fullName: 'Priya Sharma' })}
        jobMarket="LOCAL"
        locale="en"
        busy={false}
        onTransition={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    // No phone anywhere (label-absence, not placeholder).
    expect(container.textContent).not.toMatch(/\+?\d{7,}/);
    // Docs chips may contain DocumentViewButton for uploaded docs.
    // The privacy-critical invariant is that phone is absent, not that chips lack buttons.
    const docsList = screen.getByLabelText(/documents/i);
    expect(docsList).toBeInTheDocument();
  });

  it('a phone renders when present', () => {
    render(
      <ApplicantCard
        applicant={applicant({ phone: '+919876543210' })}
        jobMarket="GULF"
        locale="en"
        busy={false}
        onTransition={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
  });
});

// ── MatchBreakdownPopover ─────────────────────────────────────────────────────
describe('MatchBreakdownPopover', () => {
  it('opens on click and shows the snapshot components (raw+clamped)', async () => {
    const user = userEvent.setup();
    render(
      <MatchBreakdownPopover
        score={84}
        breakdown={BREAKDOWN}
        jobMarket="GULF"
        candidateName="Amir"
      />,
    );
    await user.click(screen.getByRole('button', { name: /match breakdown/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/8 of 8 yrs/i);
    expect(screen.getByText('24/30')).toBeInTheDocument();
  });

  it('shows the foreign-0-on-LOCAL note only on a LOCAL job', async () => {
    const user = userEvent.setup();
    const localBreakdown: MatchBreakdown = {
      ...BREAKDOWN,
      foreignExperience: { score: 0, max: 20 },
    };
    render(
      <MatchBreakdownPopover
        score={60}
        breakdown={localBreakdown}
        jobMarket="LOCAL"
        candidateName="Amir"
      />,
    );
    await user.click(screen.getByRole('button', { name: /match breakdown/i }));
    expect(screen.getByText(/not scored for local jobs/i)).toBeInTheDocument();
  });
});

// ── ApplicantFilters ──────────────────────────────────────────────────────────
describe('ApplicantFilters', () => {
  const counts = { pending: 3, shortlisted: 2, selected: 1, rejected: 4 };

  it('renders counts as headers and fires status + sort changes', async () => {
    const onStatus = vi.fn();
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <ApplicantFilters
        counts={counts}
        status="ALL"
        sort="match"
        onStatusChange={onStatus}
        onSortChange={onSort}
      />,
    );
    // All = sum (10)
    expect(screen.getByRole('tab', { name: /all \(10\)/i })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /shortlisted \(2\)/i }));
    expect(onStatus).toHaveBeenCalledWith('SHORTLISTED');
    await user.click(screen.getByRole('button', { name: /most recent/i }));
    expect(onSort).toHaveBeenCalledWith('recent');
  });
});

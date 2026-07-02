import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { BenefitsSection } from '../jobform/BenefitsSection';
import { JobLivePreview } from '../jobform/JobLivePreview';
import { PublishErrorHandler } from '../jobform/PublishErrorHandler';
import { JobStatusBadge } from '../myjobs/JobStatusBadge';
import { MyJobsTable } from '../myjobs/MyJobsTable';
import { DEFAULT_FORM_VALUES, type JobFormValues } from '../../../lib/jobs/jobFormState';

// ─── Mock next/navigation ─────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/en/employer/jobs',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Intl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

function loginAsEmployer(userId = EMPLOYER_APPROVED_USER_ID) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}

beforeEach(() => {
  resetClient();
  mockPush.mockClear();
  mockReplace.mockClear();
});

// ─── BenefitsSection ─────────────────────────────────────────────────────────

describe('BenefitsSection — mandatory locks + optional toggles', () => {
  const defaultValues: JobFormValues = {
    ...DEFAULT_FORM_VALUES,
  };

  it('renders the three mandatory benefits as locked ON', () => {
    const onChange = vi.fn();
    render(
      <Intl>
        <BenefitsSection values={defaultValues} onChange={onChange} />
      </Intl>,
    );

    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.getByText('Health Insurance')).toBeInTheDocument();
    expect(screen.getByText('Transportation')).toBeInTheDocument();

    // The locked toggles are checkboxes with aria-checked=true and aria-disabled=true
    const lockedCheckboxes = screen.getAllByRole('checkbox', { hidden: true });
    const disabledOnes = lockedCheckboxes.filter(
      (el) => el.getAttribute('aria-disabled') === 'true',
    );
    expect(disabledOnes.length).toBe(3);
    disabledOnes.forEach((el) => {
      expect(el.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('shows policy banner', () => {
    const onChange = vi.fn();
    render(
      <Intl>
        <BenefitsSection values={defaultValues} onChange={onChange} />
      </Intl>,
    );
    expect(screen.getByText(/worker protection policy/i)).toBeInTheDocument();
  });

  it('optional benefit Food Allowance toggles freely', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Intl>
        <BenefitsSection values={defaultValues} onChange={onChange} />
      </Intl>,
    );

    const foodCheckbox = screen.getByLabelText(/food allowance/i);
    expect(foodCheckbox).not.toBeDisabled();
    await user.click(foodCheckbox);
    expect(onChange).toHaveBeenCalledWith({ foodAllowance: true });
  });

  it('optional benefit Air Tickets toggles freely', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Intl>
        <BenefitsSection values={defaultValues} onChange={onChange} />
      </Intl>,
    );

    const airTicketsCheckbox = screen.getByLabelText(/air tickets/i);
    expect(airTicketsCheckbox).not.toBeDisabled();
    await user.click(airTicketsCheckbox);
    expect(onChange).toHaveBeenCalledWith({ airTickets: true });
  });
});

// ─── JobLivePreview ───────────────────────────────────────────────────────────

describe('JobLivePreview — live preview updates + market-driven chips', () => {
  it('renders preview with form values', () => {
    const values: JobFormValues = {
      ...DEFAULT_FORM_VALUES,
      title: 'Senior Mason',
      location: 'Dubai, UAE',
      market: 'GULF',
      salaryMin: '1500',
      salaryMax: '2000',
      salaryCurrency: 'AED',
    };

    render(
      <Intl>
        <JobLivePreview values={values} companyName="Gulf Builders Arabia" locale="en" />
      </Intl>,
    );

    expect(screen.getByText('Senior Mason')).toBeInTheDocument();
    expect(screen.getByText('Dubai, UAE')).toBeInTheDocument();
    expect(screen.getByText('Gulf Builders Arabia')).toBeInTheDocument();
    expect(screen.getByText('Gulf')).toBeInTheDocument();
  });

  it('shows Gulf benefit chips for GULF market', () => {
    const values: JobFormValues = {
      ...DEFAULT_FORM_VALUES,
      market: 'GULF',
      accommodation: true,
      healthInsurance: true,
      transportation: true,
    };

    render(
      <Intl>
        <JobLivePreview values={values} companyName="Test Co" locale="en" />
      </Intl>,
    );

    // GULF market shows Accommodation / Food / Transport labels
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
  });

  it('shows Local benefit chips for LOCAL market', () => {
    const values: JobFormValues = {
      ...DEFAULT_FORM_VALUES,
      market: 'LOCAL',
      accommodation: true,
      healthInsurance: true,
      transportation: true,
    };

    render(
      <Intl>
        <JobLivePreview values={values} companyName="Local Co" locale="en" />
      </Intl>,
    );

    // LOCAL market relabels: PF/ESI/Bonus
    expect(screen.getByText('PF')).toBeInTheDocument();
  });
});

// ─── PublishErrorHandler ─────────────────────────────────────────────────────

describe('PublishErrorHandler — maps all three publish errors', () => {
  it('renders EMPLOYER_NOT_APPROVED message', () => {
    render(
      <Intl>
        <PublishErrorHandler
          error={{
            code: 'EMPLOYER_NOT_APPROVED',
            status: 403,
            title: 'Employer not approved',
            detail: 'Company must be approved.',
          }}
        />
      </Intl>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/company approval required/i)).toBeInTheDocument();
  });

  it('renders WORKER_PROTECTION_VIOLATION with which rules failed', () => {
    render(
      <Intl>
        <PublishErrorHandler
          error={{
            code: 'WORKER_PROTECTION_VIOLATION',
            status: 422,
            title: 'Worker protection violation',
            detail: 'Required benefits missing.',
            meta: { violations: ['accommodation', 'healthInsurance'] },
          }}
        />
      </Intl>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/worker protection violation/i)).toBeInTheDocument();
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.getByText('Health Insurance')).toBeInTheDocument();
  });

  it('renders JOB_QUOTA_EXCEEDED with upgrade link', () => {
    render(
      <Intl>
        <PublishErrorHandler
          error={{
            code: 'JOB_QUOTA_EXCEEDED',
            status: 422,
            title: 'Job quota exceeded',
            detail: 'Free plan allows 1 active job.',
            meta: { planLimit: 1, activeCount: 1 },
          }}
        />
      </Intl>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/active job limit reached/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upgrade to pro/i })).toBeInTheDocument();
  });
});

// ─── JobStatusBadge ───────────────────────────────────────────────────────────

describe('JobStatusBadge', () => {
  it.each([
    ['ACTIVE', 'Active'],
    ['DRAFT', 'Draft'],
    ['PAUSED', 'Paused'],
    ['ARCHIVED', 'Archived'],
  ] as const)('renders %s status correctly', (status, label) => {
    render(
      <Intl>
        <JobStatusBadge status={status} />
      </Intl>,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

// ─── MyJobsTable ─────────────────────────────────────────────────────────────

describe('MyJobsTable', () => {
  it('shows loading spinner then renders jobs', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);
    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    // Loading spinner should appear first
    expect(screen.getByRole('status', { hidden: true }) || document.body).toBeDefined();

    // Jobs from the approved employer fixture (job-1, job-2, job-3 are ACTIVE, job-4 is DRAFT)
    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });
    expect(screen.getByText('Senior Electrician')).toBeInTheDocument();
  });

  it('filters by DRAFT status when Draft tab is clicked', async () => {
    const user = userEvent.setup();
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /drafts/i }));

    await waitFor(() => {
      expect(screen.getByText('General Helper')).toBeInTheDocument();
    });

    // ACTIVE jobs should not appear when Draft tab is selected
    expect(screen.queryByText('Experienced Mason')).not.toBeInTheDocument();
  });

  it('shows empty state when no company', async () => {
    // Use an employer with no company
    const token = makeAccessToken('mock-user-no-company');
    setAccessToken(token);

    // Override to return empty
    server.use(
      http.get('/api/v1/employers/me/jobs', () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
      ),
    );

    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument();
    });
  });

  it('ACTIVE job shows Pause action; DRAFT job shows Publish action', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });

    // ACTIVE jobs should have Pause buttons
    const pauseButtons = screen.getAllByRole('button', { name: /pause job/i });
    expect(pauseButtons.length).toBeGreaterThan(0);

    // Switch to Drafts tab and check for Publish button
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /drafts/i }));

    await waitFor(() => {
      expect(screen.getByText('General Helper')).toBeInTheDocument();
    });

    const publishButton = screen.getByRole('button', { name: /publish job/i });
    expect(publishButton).toBeInTheDocument();
  });

  it('application counts show 0 (S4 placeholder — not fabricated)', async () => {
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });

    // All application counts should be 0 (honest placeholder)
    const zeroCounts = screen.getAllByLabelText(/0 applications/i);
    expect(zeroCounts.length).toBeGreaterThan(0);
  });

  it('Pause action calls /pause and optimistically updates status', async () => {
    const user = userEvent.setup();
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });

    // Click the Pause button for Experienced Mason (job-1)
    const pauseButtons = screen.getAllByRole('button', { name: /pause job.*experienced mason/i });
    await user.click(pauseButtons[0]!);

    // After pause, the status badge should update to Paused (optimistic)
    await waitFor(() => {
      expect(screen.getByLabelText(/status: paused/i)).toBeInTheDocument();
    });
  });

  it('Duplicate action adds a new job row', async () => {
    const user = userEvent.setup();
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    // Start with All tab showing jobs
    render(
      <Intl>
        <MyJobsTable />
      </Intl>,
    );

    await waitFor(() => {
      expect(screen.getByText('Experienced Mason')).toBeInTheDocument();
    });

    const initialMasonCount = screen.getAllByText('Experienced Mason').length;

    // Click Duplicate on job-1
    const duplicateButtons = screen.getAllByRole('button', {
      name: /duplicate job.*experienced mason/i,
    });
    await user.click(duplicateButtons[0]!);

    // A copy should appear in the list
    await waitFor(() => {
      const copies = screen.getAllByText(/experienced mason/i);
      expect(copies.length).toBeGreaterThan(initialMasonCount);
    });
  });
});

// ─── JobForm — POST /jobs (Save as Draft) ─────────────────────────────────────

describe('JobForm — Save as Draft calls POST /jobs', () => {
  it('saves draft and shows saved confirmation', async () => {
    const user = userEvent.setup();
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    // Import JobForm inline to avoid hoisting issues
    const { JobForm } = await import('../jobform/JobForm');

    render(
      <Intl>
        <JobForm />
      </Intl>,
    );

    // Fill required fields
    await user.clear(screen.getByLabelText(/job title/i));
    await user.type(screen.getByLabelText(/job title/i), 'Test Welder');
    await user.clear(screen.getByLabelText(/location/i));
    await user.type(screen.getByLabelText(/location/i), 'Dubai, UAE');

    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument();
    });
  });
});

// ─── JobForm — Publish error: EMPLOYER_NOT_APPROVED ───────────────────────────

describe('JobForm — Publish errors', () => {
  it('shows EMPLOYER_NOT_APPROVED error when employer not approved', async () => {
    const user = userEvent.setup();
    // Use pending employer — they are not approved
    loginAsEmployer(EMPLOYER_PENDING_USER_ID);

    const { JobForm } = await import('../jobform/JobForm');

    render(
      <Intl>
        <JobForm />
      </Intl>,
    );

    await user.clear(screen.getByLabelText(/job title/i));
    await user.type(screen.getByLabelText(/job title/i), 'Test Helper');
    await user.clear(screen.getByLabelText(/location/i));
    await user.type(screen.getByLabelText(/location/i), 'Abu Dhabi, UAE');

    await user.click(screen.getByRole('button', { name: /post job/i }));

    await waitFor(() => {
      expect(screen.getByText(/company approval required/i)).toBeInTheDocument();
    });
  });

  it('shows JOB_QUOTA_EXCEEDED with upgrade link when quota is hit', async () => {
    const user = userEvent.setup();
    loginAsEmployer(EMPLOYER_APPROVED_USER_ID);

    // job-1 is already ACTIVE for the approved employer — quota is 1
    // We need a second job to trigger the quota
    // Override publish to return quota error
    server.use(
      http.post('/api/v1/jobs/:id/publish', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Job quota exceeded',
            status: 422,
            detail: 'Free plan allows 1 active job.',
            code: 'JOB_QUOTA_EXCEEDED',
            meta: { planLimit: 1, activeCount: 1 },
          },
          { status: 422 },
        ),
      ),
    );

    const { JobForm } = await import('../jobform/JobForm');

    render(
      <Intl>
        <JobForm />
      </Intl>,
    );

    await user.clear(screen.getByLabelText(/job title/i));
    await user.type(screen.getByLabelText(/job title/i), 'New Plumber');
    await user.clear(screen.getByLabelText(/location/i));
    await user.type(screen.getByLabelText(/location/i), 'Doha, Qatar');

    await user.click(screen.getByRole('button', { name: /post job/i }));

    await waitFor(() => {
      expect(screen.getByText(/active job limit reached/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /upgrade to pro/i })).toBeInTheDocument();
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../i18n/messages/en.json';
import { server } from '../../../mocks/server';
import { http, HttpResponse } from 'msw';
import {
  db,
  makeAccessToken,
  EMPLOYER_PENDING_USER_ID,
  EMPLOYER_REJECTED_USER_ID,
} from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { AuthProvider } from '../../../lib/auth/auth-context';
import { EmployerProvider } from '../../../lib/employer/employer-context';
import { EmployerLoginForm } from '../EmployerLoginForm';
import { CompanyTypeRadio } from '../CompanyTypeRadio';
import { CompanyOnboardingForm } from '../CompanyOnboardingForm';
import { EmployerKpis } from '../dashboard/EmployerKpis';
import { PostFirstJobCta } from '../dashboard/PostFirstJobCta';
import { RecentJobsTable } from '../dashboard/RecentJobsTable';
import { RecentApplicants } from '../dashboard/RecentApplicants';

// ─── Mock next/navigation ─────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/en/employer/onboarding',
  useParams: () => ({ locale: 'en' }),
}));

// ─── Mock useEmployerCertUpload ───────────────────────────────────────────────
// CertificateUpload uses XHR internally which doesn't work in jsdom.
// We mock the hook so we can control cert state per-test.

const mockCertRun = vi.fn();
const mockCertRetry = vi.fn();
const mockCertReset = vi.fn();
let mockCertState = {
  status: 'idle' as string,
  progress: 0,
  key: null as string | null,
  errorMessage: null as string | null,
};

vi.mock('@/lib/employer/useEmployerCertUpload', () => ({
  useEmployerCertUpload: () => ({
    state: mockCertState,
    run: mockCertRun,
    retry: mockCertRetry,
    reset: mockCertReset,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function WithAll({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthProvider>
        <EmployerProvider>{children}</EmployerProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

function WithIntl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

function loginAsEmployer(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}

beforeEach(() => {
  resetClient();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockCertRun.mockReset();
  mockCertRetry.mockReset();
  mockCertReset.mockReset();
  mockCertState = { status: 'idle', progress: 0, key: null, errorMessage: null };
});

afterEach(() => {
  server.resetHandlers();
});

// ─── EmployerLoginForm ────────────────────────────────────────────────────────

describe('EmployerLoginForm', () => {
  it('has NO Google sign-in button', () => {
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull();
  });

  it('has a "Register your company" link → /en/signup?role=employer', () => {
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );
    const link = screen.getByRole('link', { name: /register your company/i });
    expect(link).toHaveAttribute('href', '/en/signup?role=employer');
  });

  it('has a candidate cross-link → /en/login', () => {
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );
    const links = screen.getAllByRole('link');
    const candidateLink = links.find((l) => l.getAttribute('href') === '/en/login');
    expect(candidateLink).toBeTruthy();
  });

  it('shows INVALID_CREDENTIALS error on bad login', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );

    await user.type(screen.getByLabelText(/work email/i), 'nobody@nowhere.com');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/incorrect email or password/i);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('routes to /employer/dashboard when employer already has a company', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );

    // EMPLOYER_APPROVED_USER_ID maps to employer@example.com which has a company
    await user.type(screen.getByLabelText(/work email/i), 'employer@example.com');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'any-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/employer/dashboard');
    });
  });

  it('routes to /employer/onboarding when employer has no company (404)', async () => {
    const user = userEvent.setup();

    // Create a fresh employer user with no company in the mock db
    const freshId = `fresh-emp-${Date.now()}`;
    db.users.set(freshId, {
      id: freshId,
      email: `fresh-${freshId}@test.com`,
      passwordHash: 'hashed',
      role: 'EMPLOYER',
      status: 'ACTIVE',
    });

    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );

    await user.type(screen.getByLabelText(/work email/i), `fresh-${freshId}@test.com`);
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'any-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/employer/onboarding');
    });

    // Cleanup
    db.users.delete(freshId);
  });

  it('routes suspended employer to /employer/dashboard without showing an error', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <EmployerLoginForm />
      </WithAll>,
    );

    // MSW returns 403 ACCOUNT_SUSPENDED for this user.
    // The form catches that code and redirects to dashboard — suspension is
    // communicated via the F0 shell's CompanyStateBanner, not a login error.
    await user.type(screen.getByLabelText(/work email/i), 'employer-suspended@example.com');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'any-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/employer/dashboard');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ─── CompanyTypeRadio ─────────────────────────────────────────────────────────

describe('CompanyTypeRadio', () => {
  it('renders LOCAL and FOREIGN radio options', () => {
    render(
      <WithIntl>
        <CompanyTypeRadio value="" onChange={vi.fn()} />
      </WithIntl>,
    );
    expect(screen.getByRole('radio', { name: /local company/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /foreign/i })).toBeInTheDocument();
  });

  it('calls onChange with "LOCAL" when Local option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WithIntl>
        <CompanyTypeRadio value="" onChange={onChange} />
      </WithIntl>,
    );
    await user.click(screen.getByRole('radio', { name: /local company/i }));
    expect(onChange).toHaveBeenCalledWith('LOCAL');
  });

  it('calls onChange with "FOREIGN" when Foreign option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WithIntl>
        <CompanyTypeRadio value="" onChange={onChange} />
      </WithIntl>,
    );
    await user.click(screen.getByRole('radio', { name: /foreign/i }));
    expect(onChange).toHaveBeenCalledWith('FOREIGN');
  });

  it('marks the currently selected option as checked', () => {
    render(
      <WithIntl>
        <CompanyTypeRadio value="LOCAL" onChange={vi.fn()} />
      </WithIntl>,
    );
    expect(screen.getByRole('radio', { name: /local company/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /foreign/i })).not.toBeChecked();
  });

  it('shows the required error message when error prop is set', () => {
    render(
      <WithIntl>
        <CompanyTypeRadio value="" onChange={vi.fn()} error="Please select a company type" />
      </WithIntl>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/please select a company type/i);
  });
});

// ─── CompanyOnboardingForm — initial registration ─────────────────────────────

describe('CompanyOnboardingForm — initial registration', () => {
  beforeEach(() => {
    // Fresh employer with no company
    const freshId = 'form-test-employer';
    db.users.set(freshId, {
      id: freshId,
      email: 'formtest@example.com',
      passwordHash: 'hashed',
      role: 'EMPLOYER',
      status: 'ACTIVE',
    });
    db.employers.delete(freshId);
    loginAsEmployer(freshId);
  });

  afterEach(() => {
    db.users.delete('form-test-employer');
    db.employers.delete('form-test-employer');
  });

  it('shows "Submit for approval" button (not resubmit) for initial mode', () => {
    render(
      <WithIntl>
        <CompanyOnboardingForm company={null} />
      </WithIntl>,
    );
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
  });

  it('blocks submit and shows required-field errors when form is empty', async () => {
    const user = userEvent.setup();
    render(
      <WithIntl>
        <CompanyOnboardingForm company={null} />
      </WithIntl>,
    );

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/please select a company type/i)).toBeInTheDocument();
      expect(screen.getByText(/company name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/company phone is required/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('blocks submit with cert-required error when no cert has been uploaded', async () => {
    const user = userEvent.setup();
    // mockCertState is 'idle' (no key) by default
    render(
      <WithIntl>
        <CompanyOnboardingForm company={null} />
      </WithIntl>,
    );

    await user.click(screen.getByRole('radio', { name: /local company/i }));
    await user.type(screen.getByPlaceholderText(/your company legal name/i), 'Test Co');
    await user.type(screen.getByPlaceholderText(/\+91 98765 43210/i), '+919876543210');
    await user.type(screen.getByPlaceholderText(/city, state or country/i), 'Mumbai');
    await user.selectOptions(screen.getByLabelText(/number of employees/i), '11-50');

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/please upload your registration certificate/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('calls POST /employers/register and shows success on valid submission', async () => {
    const user = userEvent.setup();
    // Simulate cert uploaded and done — CertificateUpload calls onKey via useEffect.
    // WithIntl (no AuthProvider) ensures our token isn't cleared by doRefresh().
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/form-test-employer/cert.pdf',
      errorMessage: null,
    };

    render(
      <WithIntl>
        <CompanyOnboardingForm company={null} />
      </WithIntl>,
    );

    await user.click(screen.getByRole('radio', { name: /local company/i }));
    await user.type(screen.getByPlaceholderText(/your company legal name/i), 'Test Corp');
    await user.type(screen.getByPlaceholderText(/\+91 98765 43210/i), '+911234567890');
    await user.type(screen.getByPlaceholderText(/city, state or country/i), 'Delhi');
    await user.selectOptions(screen.getByLabelText(/number of employees/i), '1-10');

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitted/i);
    });
  });

  it('shows COMPANY_ALREADY_EXISTS error on 409 when company is already registered', async () => {
    const user = userEvent.setup();
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/cert.pdf',
      errorMessage: null,
    };

    // Switch to an employer who already has a company
    loginAsEmployer(EMPLOYER_PENDING_USER_ID);

    render(
      <WithIntl>
        <CompanyOnboardingForm company={null} />
      </WithIntl>,
    );

    await user.click(screen.getByRole('radio', { name: /local company/i }));
    await user.type(screen.getByPlaceholderText(/your company legal name/i), 'Duplicate Co');
    await user.type(screen.getByPlaceholderText(/\+91 98765 43210/i), '+911234567890');
    await user.type(screen.getByPlaceholderText(/city, state or country/i), 'Mumbai');
    await user.selectOptions(screen.getByLabelText(/number of employees/i), '1-10');

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/company profile already exists/i);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─── CompanyOnboardingForm — resubmit (REJECTED company) ─────────────────────

describe('CompanyOnboardingForm — resubmit', () => {
  const rejectedCompany = db.employers.get(EMPLOYER_REJECTED_USER_ID)!;

  beforeEach(() => {
    loginAsEmployer(EMPLOYER_REJECTED_USER_ID);
    // Reset the company status to REJECTED in case a prior test dirtied it
    const company = db.employers.get(EMPLOYER_REJECTED_USER_ID);
    if (company) {
      company.status = 'REJECTED';
      company.rejectionReason =
        'Registration certificate could not be verified. Please resubmit with a valid certificate.';
    }
  });

  it('shows "Resubmit for approval" button label', () => {
    render(
      <WithIntl>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithIntl>,
    );
    expect(screen.getByRole('button', { name: /resubmit for approval/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submit for approval$/i })).toBeNull();
  });

  it('pre-fills company name, phone, and location from the rejected company', () => {
    render(
      <WithIntl>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithIntl>,
    );
    expect(screen.getByDisplayValue('Apex Manpower Solutions')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+919876500000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Delhi, India')).toBeInTheDocument();
  });

  it('pre-selects LOCAL radio for a LOCAL company', () => {
    render(
      <WithIntl>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithIntl>,
    );
    expect(screen.getByRole('radio', { name: /local company/i })).toBeChecked();
  });

  it('calls PATCH /employers/me/company on submit and transitions REJECTED → PENDING', async () => {
    const user = userEvent.setup();
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/resubmit-cert.pdf',
      errorMessage: null,
    };

    let capturedMethod = '';
    let capturedBody: Record<string, unknown> = {};

    server.use(
      http.patch('/api/v1/employers/me/company', async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = (await request.json()) as Record<string, unknown>;
        const company = db.employers.get(EMPLOYER_REJECTED_USER_ID);
        if (company) {
          Object.assign(company, capturedBody);
          company.status = 'PENDING';
          company.rejectionReason = null;
        }
        return HttpResponse.json({ data: company });
      }),
    );

    render(
      <WithIntl>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithIntl>,
    );

    // Form is pre-filled; submit without changing fields
    await user.click(screen.getByRole('button', { name: /resubmit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitted/i);
    });

    expect(capturedMethod).toBe('PATCH');
    expect(capturedBody).toMatchObject({ name: 'Apex Manpower Solutions' });
  });
});

// ─── EmployerKpis ─────────────────────────────────────────────────────────────

describe('EmployerKpis', () => {
  it('renders four KPI cards with all-zero values (honest S2 state)', () => {
    render(
      <WithIntl>
        <EmployerKpis kpis={{ activeJobs: 0, totalApplications: 0, shortlisted: 0, selected: 0 }} />
      </WithIntl>,
    );
    // Four KPI values — all 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
    // KPI labels
    expect(screen.getByText(/active jobs/i)).toBeInTheDocument();
    expect(screen.getByText(/total applications/i)).toBeInTheDocument();
    expect(screen.getByText(/shortlisted/i)).toBeInTheDocument();
    expect(screen.getByText(/hired/i)).toBeInTheDocument();
  });

  it('renders non-zero values from the API response', () => {
    render(
      <WithIntl>
        <EmployerKpis
          kpis={{ activeJobs: 3, totalApplications: 12, shortlisted: 4, selected: 1 }}
        />
      </WithIntl>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

// ─── PostFirstJobCta ──────────────────────────────────────────────────────────

describe('PostFirstJobCta', () => {
  it('renders a clickable link to /employer/jobs/new when company is APPROVED', () => {
    render(
      <WithIntl>
        <PostFirstJobCta companyStatus="APPROVED" />
      </WithIntl>,
    );
    const link = screen.getByRole('link', { name: /post a job/i });
    expect(link).toHaveAttribute('href', '/en/employer/jobs/new');
  });

  it('renders a disabled span (not a link) with tooltip when company is PENDING', () => {
    render(
      <WithIntl>
        <PostFirstJobCta companyStatus="PENDING" />
      </WithIntl>,
    );
    // No navigable link
    expect(screen.queryByRole('link', { name: /post a job/i })).toBeNull();
    // Disabled span with tooltip communicating the gate
    const disabledEl = screen.getByTitle(/available after company approval/i);
    expect(disabledEl).toBeTruthy();
  });

  it('renders a disabled span when company is REJECTED', () => {
    render(
      <WithIntl>
        <PostFirstJobCta companyStatus="REJECTED" />
      </WithIntl>,
    );
    expect(screen.queryByRole('link', { name: /post a job/i })).toBeNull();
  });

  it('renders a disabled span when company is SUSPENDED', () => {
    render(
      <WithIntl>
        <PostFirstJobCta companyStatus="SUSPENDED" />
      </WithIntl>,
    );
    expect(screen.queryByRole('link', { name: /post a job/i })).toBeNull();
  });
});

// ─── RecentJobsTable ──────────────────────────────────────────────────────────

describe('RecentJobsTable', () => {
  it('shows empty state when jobs array is empty', () => {
    render(
      <WithIntl>
        <RecentJobsTable jobs={[]} />
      </WithIntl>,
    );
    expect(screen.getByText(/no jobs posted yet/i)).toBeInTheDocument();
    expect(screen.getByText(/post your first job/i)).toBeInTheDocument();
  });

  it('renders job rows when jobs are provided', () => {
    const mockJobs = [
      {
        id: 'job-test-1',
        title: 'Senior Mason',
        market: 'GULF' as const,
        location: 'Dubai, UAE',
        companyName: 'Test Corp',
        salaryCurrency: 'AED',
        salaryMin: 1500,
        salaryMax: 2000,
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        createdAt: new Date().toISOString(),
        isSaved: false,
      },
    ];
    render(
      <WithIntl>
        <RecentJobsTable jobs={mockJobs} />
      </WithIntl>,
    );
    expect(screen.getByText('Senior Mason')).toBeInTheDocument();
    expect(screen.queryByText(/no jobs posted yet/i)).toBeNull();
  });
});

// ─── RecentApplicants ────────────────────────────────────────────────────────

describe('RecentApplicants', () => {
  it('shows empty state when applicants array is empty', () => {
    render(
      <WithIntl>
        <RecentApplicants applicants={[]} />
      </WithIntl>,
    );
    expect(screen.getByText(/no applicants yet/i)).toBeInTheDocument();
    expect(screen.getByText(/applications will appear here/i)).toBeInTheDocument();
  });

  it('renders applicant name when applicants are provided', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockApplicants: any[] = [
      {
        id: 'cand-1',
        email: 'ravi@example.com',
        role: 'CANDIDATE',
        fullName: 'Ravi Kumar',
        completionPct: 80,
        profileVisible: true,
        isAvailable: true,
      },
    ];
    render(
      <WithIntl>
        <RecentApplicants applicants={mockApplicants} />
      </WithIntl>,
    );
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.queryByText(/no applicants yet/i)).toBeNull();
  });
});

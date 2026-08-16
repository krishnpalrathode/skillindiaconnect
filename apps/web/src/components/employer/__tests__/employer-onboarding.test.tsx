import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../../../test-utils';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '../../../components/ui/toast';
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
        <EmployerProvider>
          <ToastProvider>{children}</ToastProvider>
        </EmployerProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}

function WithIntl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>{children}</ToastProvider>
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
    expect(screen.getByRole('radio', { name: /india company/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /international company/i })).toBeInTheDocument();
  });

  it('calls onChange with "LOCAL" when Local option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <WithIntl>
        <CompanyTypeRadio value="" onChange={onChange} />
      </WithIntl>,
    );
    await user.click(screen.getByRole('radio', { name: /india company/i }));
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
    await user.click(screen.getByRole('radio', { name: /international company/i }));
    expect(onChange).toHaveBeenCalledWith('FOREIGN');
  });

  it('marks the currently selected option as checked', () => {
    render(
      <WithIntl>
        <CompanyTypeRadio value="LOCAL" onChange={vi.fn()} />
      </WithIntl>,
    );
    expect(screen.getByRole('radio', { name: /india company/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /international company/i })).not.toBeChecked();
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

/**
 * Fill every field the form requires. Registration submits a COMPLETE profile —
 * registration number, industry, founding year, website and description are all
 * mandatory — so a submitting test that fills only the old subset is blocked by
 * validation and never reaches the network.
 */
async function fillCompleteProfile(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { name?: string } = {},
) {
  await user.click(screen.getByRole('radio', { name: /india company/i }));
  await user.type(
    screen.getByPlaceholderText(/your company legal name/i),
    overrides.name ?? 'Test Corp',
  );
  await user.type(screen.getByLabelText(/registration number/i), 'DL-2026-00001');
  await user.selectOptions(screen.getByLabelText(/industry type/i), 'construction');
  await user.type(screen.getByLabelText(/year founded/i), '2014');
  await user.type(screen.getByPlaceholderText(/\+91 98765 43210/i), '+911234567890');
  await user.selectOptions(screen.getByLabelText(/country/i), 'India');
  await user.type(screen.getByPlaceholderText(/city, state or country/i), 'Delhi');
  await user.type(screen.getByLabelText(/website/i), 'https://testcorp.example');
  await user.selectOptions(screen.getByLabelText(/number of employees/i), '1-10');
  await user.type(screen.getByLabelText(/company description/i), 'We hire skilled trades.');
}

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
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
  });

  it('blocks submit and shows required-field errors when form is empty', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/please select a company type/i)).toBeInTheDocument();
      expect(screen.getByText(/company name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/company phone is required/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  /**
   * The rule this change introduced: registration number, industry, founding
   * year, website and description used to be optional, so an employer could
   * submit a profile an admin could not actually review. They are required now
   * — in the form AND in the DTO, which is asserted separately in
   * register-company.dto.spec.ts.
   */
  it('blocks submit until the previously-optional fields are filled', async () => {
    const user = userEvent.setup();
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/form-test-employer/cert.pdf',
      errorMessage: null,
    };

    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    // The pre-change "valid" submission: only the fields that used to be required.
    await user.click(screen.getByRole('radio', { name: /india company/i }));
    await user.type(screen.getByPlaceholderText(/your company legal name/i), 'Partial Co');
    await user.type(screen.getByPlaceholderText(/\+91 98765 43210/i), '+911234567890');
    await user.selectOptions(screen.getByLabelText(/country/i), 'India');
    await user.type(screen.getByPlaceholderText(/city, state or country/i), 'Delhi');
    await user.selectOptions(screen.getByLabelText(/number of employees/i), '1-10');

    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/registration number is required/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/please select an industry/i)).toBeInTheDocument();
    expect(screen.getByText(/year founded is required/i)).toBeInTheDocument();
    expect(screen.getByText(/website is required/i)).toBeInTheDocument();
    expect(screen.getByText(/company description is required/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rejects a founding year in the future', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await user.type(
      screen.getByLabelText(/year founded/i),
      String(new Date().getUTCFullYear() + 1),
    );
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter a four-digit year/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('sends the founding year as a NUMBER, not the input string', async () => {
    const user = userEvent.setup();
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/form-test-employer/cert.pdf',
      errorMessage: null,
    };

    let captured: Record<string, unknown> = {};
    server.use(
      http.post('/api/v1/employers/register', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'c1', ...captured } }, { status: 201 });
      }),
    );

    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await fillCompleteProfile(user);
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => expect(captured.foundedYear).toBe(2014));
    expect(captured.registrationNumber).toBe('DL-2026-00001');
    expect(captured.website).toBe('https://testcorp.example');
  });

  it('rejects a company name made only of special characters', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await user.type(screen.getByPlaceholderText(/your company legal name/i), '---@@@');
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/company name must contain at least one letter or number/i),
      ).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('accepts punctuation INSIDE an otherwise real company name', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await user.type(screen.getByPlaceholderText(/your company legal name/i), 'L&T Ltd.');
    await user.click(screen.getByRole('button', { name: /submit for approval/i }));

    await waitFor(() => {
      expect(screen.getByText(/company phone is required/i)).toBeInTheDocument();
    });
    // The name passed — only the OTHER required fields complained.
    expect(
      screen.queryByText(/company name must contain at least one letter or number/i),
    ).toBeNull();
  });

  it('caps the company name field at 100 characters', () => {
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );
    // 20 would reject real names like "Gulf Star Contracting LLC" (25 chars).
    expect(screen.getByPlaceholderText(/your company legal name/i)).toHaveAttribute(
      'maxLength',
      '100',
    );
  });

  it('defaults the dial code to +91 and re-syncs it when the country changes', async () => {
    const user = userEvent.setup();
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    /*
      Asserted on the TRIGGER'S TEXT, not a select value. The dial picker is a
      combobox rather than a `<select>` because an `<option>` cannot contain an
      image and the flags have to render on Windows too. What the employer reads,
      and what is submitted as `phoneCode`, is still the dial code.
    */
    expect(screen.getByRole('combobox', { name: /code/i })).toHaveTextContent('+91');

    await user.selectOptions(screen.getByLabelText(/country/i), 'United Arab Emirates');
    expect(screen.getByRole('combobox', { name: /code/i })).toHaveTextContent('+971');
  });

  it('blocks submit with cert-required error when no cert has been uploaded', async () => {
    const user = userEvent.setup();
    // mockCertState is 'idle' (no key) by default
    render(
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    // Everything EXCEPT the certificate, so this test fails for the one reason
    // it names rather than tripping over an unrelated required field.
    await fillCompleteProfile(user, { name: 'Test Co' });

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
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await fillCompleteProfile(user);

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
      <WithAll>
        <CompanyOnboardingForm company={null} />
      </WithAll>,
    );

    await fillCompleteProfile(user, { name: 'Duplicate Co' });

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
      <WithAll>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithAll>,
    );
    expect(screen.getByRole('button', { name: /resubmit for approval/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submit for approval$/i })).toBeNull();
  });

  it('pre-fills company name, phone, country and location from the rejected company', () => {
    render(
      <WithAll>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithAll>,
    );
    expect(screen.getByDisplayValue('Apex Manpower Solutions')).toBeInTheDocument();
    // Dial code and national number are separate controls, not one merged value.
    // The code picker is a combobox keyed by ISO (see the defaults test), so the
    // stored "+91" is asserted through the text the employer actually sees.
    expect(screen.getByRole('combobox', { name: /code/i })).toHaveTextContent('+91');
    expect(screen.getByLabelText(/company phone/i)).toHaveValue('9876500000');
    expect(screen.getByLabelText(/country/i)).toHaveValue('India');
    expect(screen.getByDisplayValue('Delhi')).toBeInTheDocument();
  });

  it('pre-selects LOCAL radio for a LOCAL company', () => {
    render(
      <WithAll>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithAll>,
    );
    expect(screen.getByRole('radio', { name: /india company/i })).toBeChecked();
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
      <WithAll>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithAll>,
    );

    // Form is pre-filled; submit without changing fields
    await user.click(screen.getByRole('button', { name: /resubmit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitted/i);
    });

    expect(capturedMethod).toBe('PATCH');
    expect(capturedBody).toMatchObject({ name: 'Apex Manpower Solutions' });
  });

  /*
    The picker is keyed by ISO because dial codes are not unique, but ISO is a UI
    concern — `Company.phoneCode` stores the DIAL CODE. Submitting "PH" instead
    of "+63" would be invisible in the form and would corrupt every phone number
    the operations team tries to ring, so it is pinned here.
  */
  it('submits the DIAL CODE for the chosen country, not its ISO code', async () => {
    const user = userEvent.setup();
    mockCertState = {
      status: 'done',
      progress: 100,
      key: 'employer-docs/resubmit-cert.pdf',
      errorMessage: null,
    };

    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.patch('/api/v1/employers/me/company', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        const company = db.employers.get(EMPLOYER_REJECTED_USER_ID);
        return HttpResponse.json({ data: { ...company, status: 'PENDING' } });
      }),
    );

    render(
      <WithAll>
        <CompanyOnboardingForm company={rejectedCompany} />
      </WithAll>,
    );

    /*
      Philippines — a country outside the recruit-market list, which is the whole
      reason the phone picker is broader than the Country select. Driven through
      the combobox the way a user would: open it, filter, pick the row.
    */
    await user.click(screen.getByRole('combobox', { name: /code/i }));
    await user.type(screen.getByPlaceholderText(/search country or code/i), 'philippines');
    await user.click(await screen.findByRole('option', { name: /philippines/i }));

    await user.click(screen.getByRole('button', { name: /resubmit for approval/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitted/i);
    });

    expect(capturedBody.phoneCode).toBe('+63');
  });
});

// ─── EmployerKpis ─────────────────────────────────────────────────────────────

describe('EmployerKpis', () => {
  it('renders four KPI cards with all-zero values (honest S3 state)', () => {
    render(
      <WithIntl>
        <EmployerKpis
          kpis={{
            activeJobs: 0,
            totalApplications: 0,
            shortlisted: 0,
            totalJobViews: 0,
            hiredThisMonth: 0,
          }}
        />
      </WithIntl>,
    );
    // Four KPI values — all 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
    // KPI labels
    expect(screen.getByText(/active jobs/i)).toBeInTheDocument();
    expect(screen.getByText(/total applications/i)).toBeInTheDocument();
    expect(screen.getByText(/shortlisted/i)).toBeInTheDocument();
    expect(screen.getByText(/total job views/i)).toBeInTheDocument();
  });

  it('renders non-zero values from the API response', () => {
    render(
      <WithIntl>
        <EmployerKpis
          kpis={{
            activeJobs: 3,
            totalApplications: 12,
            shortlisted: 4,
            totalJobViews: 87,
            hiredThisMonth: 1,
          }}
        />
      </WithIntl>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
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
        applicationId: 'app-1',
        candidateId: 'cand-1',
        candidateName: 'Ravi Kumar',
        jobId: 'job-1',
        jobTitle: 'Experienced Mason',
        status: 'PENDING',
        matchScore: 72,
        appliedAt: new Date().toISOString(),
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

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../../../test-utils';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '../../../components/ui/toast';
import enMessages from '../../../i18n/messages/en.json';
import { db, makeAccessToken, EMPLOYER_APPROVED_USER_ID } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { ChecklistNudge } from '../profile/ChecklistNudge';
import { CompanyInfoSection } from '../profile/CompanyInfoSection';
import { HiringPreferencesSection } from '../profile/HiringPreferencesSection';
import { ContactPersonsSection } from '../profile/ContactPersonsSection';
import { CompanyDocumentsSection } from '../profile/CompanyDocumentsSection';
import { AccountSettingsSection } from '../profile/AccountSettingsSection';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/employer/profile',
  useParams: () => ({ locale: 'en' }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function I18n({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>{children}</ToastProvider>
    </NextIntlClientProvider>
  );
}

function loginAsApprovedEmployer() {
  const token = makeAccessToken(EMPLOYER_APPROVED_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: EMPLOYER_APPROVED_USER_ID, accessToken: token });
}

beforeEach(() => {
  resetClient();
  db.contactPersons.set(EMPLOYER_APPROVED_USER_ID, []);
  db.hiringPreferences.delete(EMPLOYER_APPROVED_USER_ID);
  db.companyLogos.delete(EMPLOYER_APPROVED_USER_ID);
});

// ─── CompanyInfoSection ───────────────────────────────────────────────────────

describe('CompanyInfoSection', () => {
  it('saves via PATCH /employers/me/company and calls onUpdated', async () => {
    loginAsApprovedEmployer();

    const company = db.employers.get(EMPLOYER_APPROVED_USER_ID)!;
    const onUpdated = vi.fn();

    render(
      <I18n>
        <CompanyInfoSection company={company} onUpdated={onUpdated} />
      </I18n>,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    const nameInput = screen.getByRole('textbox', { name: /company name/i });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Company Name');

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Company Name' }));
    });
  });

  it('shows company TYPE as read-only in edit mode (cannot be changed hint)', () => {
    const company = db.employers.get(EMPLOYER_APPROVED_USER_ID)!;

    render(
      <I18n>
        <CompanyInfoSection company={company} onUpdated={vi.fn()} />
      </I18n>,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    // typeReadOnlyHint contains "cannot be changed here" — unique phrase
    expect(screen.getByText(/cannot be changed here/i)).toBeInTheDocument();
    // No input for company type — only a static badge
    expect(screen.queryByRole('combobox', { name: /company type/i })).not.toBeInTheDocument();
  });
});

// ─── HiringPreferencesSection ─────────────────────────────────────────────────

describe('HiringPreferencesSection', () => {
  function makeProfile(overrides?: object) {
    const company = db.employers.get(EMPLOYER_APPROVED_USER_ID)!;
    return {
      company,
      contacts: [],
      logoUrl: null,
      profileChecklist: {
        hasLogo: false,
        hasHiringPreferences: false,
        hasSecondContact: false,
        hasDescription: false,
        hint: 'Add hiring preferences',
      },
      ...overrides,
    };
  }

  it('saves hiring prefs and calls onUpdated', async () => {
    loginAsApprovedEmployer();

    const onUpdated = vi.fn();

    render(
      <I18n>
        <HiringPreferencesSection profile={makeProfile()} onUpdated={onUpdated} />
      </I18n>,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    // Category picker is fed by GET /job-categories — real IDs, never free text
    // (the API validates preferredCategories as job-category UUIDs).
    await userEvent.click(await screen.findByRole('checkbox', { name: /electrician/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /plumber/i }));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ preferredCategories: ['cat-electrician', 'cat-plumber'] }),
      );
    });
  });

  it('shows empty hint when no prefs saved', () => {
    render(
      <I18n>
        <HiringPreferencesSection profile={makeProfile()} onUpdated={vi.fn()} />
      </I18n>,
    );

    expect(screen.getByText(/add hiring preferences/i)).toBeInTheDocument();
  });

  it('shows chips in view mode when prefs exist (ids resolved to names)', async () => {
    const profile = makeProfile({
      hiringPreferences: {
        preferredCategories: ['cat-mason', 'cat-carpenter'],
        preferredNationalities: ['Indian'],
        minExperience: 2,
        notes: '',
      },
    });

    render(
      <I18n>
        <HiringPreferencesSection profile={profile} onUpdated={vi.fn()} />
      </I18n>,
    );

    // Names appear once GET /job-categories resolves the stored ids.
    expect(await screen.findByText('Mason')).toBeInTheDocument();
    expect(screen.getByText('Carpenter')).toBeInTheDocument();
  });
});

// ─── ContactPersonsSection ────────────────────────────────────────────────────

describe('ContactPersonsSection', () => {
  it('shows empty state CTA when no contacts', () => {
    render(
      <I18n>
        <ContactPersonsSection contacts={[]} onUpdated={vi.fn()} />
      </I18n>,
    );

    expect(screen.getByText(/add at least one contact/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /add contact/i }).length).toBeGreaterThan(0);
  });

  it('adds a contact via POST and calls onUpdated', async () => {
    loginAsApprovedEmployer();

    const onUpdated = vi.fn();

    render(
      <I18n>
        <ContactPersonsSection contacts={[]} onUpdated={onUpdated} />
      </I18n>,
    );

    const addBtn = screen.getAllByRole('button', { name: /add contact/i })[0];
    if (!addBtn) throw new Error('Add contact button not found');
    fireEvent.click(addBtn);

    await userEvent.type(screen.getByRole('textbox', { name: /full name/i }), 'Rajesh Kumar');
    await userEvent.type(screen.getByRole('textbox', { name: /job title/i }), 'HR Manager');

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  it('shows contact cards with single Primary badge', () => {
    const contacts = [
      {
        id: 'c1',
        name: 'Suresh Babu',
        role: 'HR Lead',
        phone: '+919876543210',
        isPrimary: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'c2',
        name: 'Priya Nair',
        role: 'Recruiter',
        isPrimary: false,
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <I18n>
        <ContactPersonsSection contacts={contacts} onUpdated={vi.fn()} />
      </I18n>,
    );

    expect(screen.getByText('Suresh Babu')).toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
    // Exactly one Primary badge
    expect(screen.getAllByText(/^primary$/i)).toHaveLength(1);
  });
});

// ─── CompanyDocumentsSection ──────────────────────────────────────────────────

describe('CompanyDocumentsSection', () => {
  it('shows Verified badge when company is APPROVED', () => {
    const company = {
      ...db.employers.get(EMPLOYER_APPROVED_USER_ID)!,
      status: 'APPROVED' as const,
    };

    render(
      <I18n>
        <CompanyDocumentsSection company={company} onRefetch={vi.fn()} />
      </I18n>,
    );

    expect(screen.getByText(/^verified$/i)).toBeInTheDocument();
  });

  it('shows Pending review badge when company is PENDING', () => {
    const company = {
      ...db.employers.get(EMPLOYER_APPROVED_USER_ID)!,
      status: 'PENDING' as const,
    };

    render(
      <I18n>
        <CompanyDocumentsSection company={company} onRefetch={vi.fn()} />
      </I18n>,
    );

    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });
});

// ─── AccountSettingsSection ───────────────────────────────────────────────────

describe('AccountSettingsSection', () => {
  it('saves language preference via PATCH and calls onUpdated', async () => {
    loginAsApprovedEmployer();

    const company = db.employers.get(EMPLOYER_APPROVED_USER_ID)!;
    const onUpdated = vi.fn();

    render(
      <I18n>
        <AccountSettingsSection company={company} onUpdated={onUpdated} />
      </I18n>,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    const select = screen.getByRole('combobox', { name: /preferred language/i });
    fireEvent.change(select, { target: { value: 'ar' } });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ languagePref: 'ar' }));
    });
  });
});

// ─── ChecklistNudge ───────────────────────────────────────────────────────────

describe('ChecklistNudge', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows hint text when hint is non-null', () => {
    render(
      <I18n>
        <ChecklistNudge hint="Upload a company logo" />
      </I18n>,
    );

    expect(screen.getByText('Upload a company logo')).toBeInTheDocument();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('hides nudge and sets sessionStorage when dismissed', async () => {
    render(
      <I18n>
        <ChecklistNudge hint="Upload a company logo" />
      </I18n>,
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem('employer-nudge-dismissed')).toBe('1');
  });

  it('renders nothing when hint is null', () => {
    render(
      <I18n>
        <ChecklistNudge hint={null} />
      </I18n>,
    );

    // Assert the COMPONENT rendered nothing, not that the container is empty:
    // the shared test render wraps everything in ToastProvider, whose aria-live
    // region is always present (it must exist before a toast arrives, or screen
    // readers miss the announcement). `container.firstChild` is therefore that
    // region, never null.
    expect(screen.queryByRole('note')).toBeNull();
  });
});

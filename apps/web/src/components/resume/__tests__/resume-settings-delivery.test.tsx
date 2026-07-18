import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/onboarding',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { server } from '../../../mocks/server';
import {
  db,
  makeAccessToken,
  NOT_WHATSAPP_CAPABLE_USER_ID,
  RESUME_SEND_CAP,
} from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';
import { ResumeSettingsPanel } from '../ResumeSettingsPanel';
import { ResumeLanguageControl } from '../ResumeLanguageControl';
import { SendWhatsAppButton } from '../SendWhatsAppButton';
import { EmailResumeButton } from '../EmailResumeButton';
import { ResumeExportHub } from '../ResumeExportHub';

type ResumeSettings = components['schemas']['ResumeSettings'];
type CandidateProfile = components['schemas']['CandidateProfile'];

const BASE = `${window.location.origin}/api/v1`;
const AMIR = 'mock-user-candidate-1';

function loginAs(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}
const profileOf = (id: string): CandidateProfile => db.candidates.get(id)!.profile;

function seedReady(userId: string) {
  db.resumeGenerations.set(userId, {
    generationId: 'gen-ready',
    status: 'READY',
    pollCount: 3,
    resumeId: `resume-${userId}`,
    generatedAt: new Date().toISOString(),
    settingsSnapshot: db.candidates.get(userId)!.resumeSettings,
  });
}

const DEFAULTS: ResumeSettings = {
  language: 'en',
  showPhone: true,
  showReligion: false,
  showFatherName: true,
  showPassportNumber: false,
};

beforeEach(() => {
  resetClient();
  db.resumeGenerations.clear();
  db.resumeSends.clear();
  // Reset amir's settings to the defaults (some tests PATCH them).
  db.candidates.get(AMIR)!.resumeSettings = { ...DEFAULTS };
});

// A stateful wrapper so optimistic updates + rollback are visible in the DOM.
function PanelHarness({ onCommitted }: { onCommitted?: () => void }) {
  const [s, setS] = useState<ResumeSettings>({ ...DEFAULTS });
  return <ResumeSettingsPanel settings={s} onSettingsChange={setS} onCommitted={onCommitted} />;
}

// ── Settings panel: defaults, PATCH, optimistic rollback ──────────────────────
describe('ResumeSettingsPanel', () => {
  it('Show Religion + Show Passport Number default OFF; Show Phone ON', () => {
    loginAs(AMIR);
    render(<PanelHarness />);
    expect(screen.getByRole('switch', { name: /show religion/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: /show passport number/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: /show phone number/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('a toggle change PATCHes and fires onCommitted', async () => {
    loginAs(AMIR);
    const onCommitted = vi.fn();
    render(<PanelHarness onCommitted={onCommitted} />);

    await userEvent.click(screen.getByRole('switch', { name: /show passport number/i }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /show passport number/i })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(db.candidates.get(AMIR)!.resumeSettings.showPassportNumber).toBe(true);
  });

  it('a failed PATCH rolls the toggle back', async () => {
    loginAs(AMIR);
    server.use(
      http.patch(`${BASE}/candidates/me/resume/settings`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Error',
            status: 500,
            detail: 'boom',
            code: 'SERVER_ERROR',
          },
          { status: 500 },
        ),
      ),
    );
    render(<PanelHarness />);

    const sw = screen.getByRole('switch', { name: /show religion/i });
    await userEvent.click(sw);
    // Rolls back to OFF and surfaces an error.
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ── Language control: English-only, no fake HI/AR ─────────────────────────────
describe('ResumeLanguageControl', () => {
  it('offers ONLY English — no working HI/AR option', () => {
    render(<ResumeLanguageControl />);
    const select = screen.getByRole('combobox', { name: /resume language/i });
    expect(select).toBeDisabled();
    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/english/i);
    expect(
      screen.queryByRole('option', { name: /hindi|हिन्दी|arabic|العربية/i }),
    ).not.toBeInTheDocument();
  });
});

// ── Send-to-WhatsApp: the three (four) honest outcomes ────────────────────────
describe('SendWhatsAppButton', () => {
  it('capable + READY → the WhatsApp success message', async () => {
    loginAs(AMIR);
    seedReady(AMIR);
    render(<SendWhatsAppButton />);
    await userEvent.click(screen.getByRole('button', { name: /send to whatsapp/i }));
    await waitFor(() => expect(screen.getByText(/sent to your whatsapp/i)).toBeInTheDocument());
  });

  it('NOT whatsapp-capable → the EMAIL_FALLBACK message (never a WhatsApp success)', async () => {
    loginAs(NOT_WHATSAPP_CAPABLE_USER_ID);
    seedReady(NOT_WHATSAPP_CAPABLE_USER_ID);
    render(<SendWhatsAppButton />);
    await userEvent.click(screen.getByRole('button', { name: /send to whatsapp/i }));
    await waitFor(() =>
      expect(screen.getByText(/we emailed your resume to you instead/i)).toBeInTheDocument(),
    );
    // Must NOT claim a WhatsApp delivery.
    expect(screen.queryByText(/sent to your whatsapp/i)).not.toBeInTheDocument();
  });

  it('rate limit reached → the calm 429 message', async () => {
    loginAs(AMIR);
    seedReady(AMIR);
    const now = Date.now();
    db.resumeSends.set(
      AMIR,
      Array.from({ length: RESUME_SEND_CAP }, (_, i) => new Date(now - i * 1000).toISOString()),
    );
    render(<SendWhatsAppButton />);
    await userEvent.click(screen.getByRole('button', { name: /send to whatsapp/i }));
    await waitFor(() => expect(screen.getByText(/today's limit/i)).toBeInTheDocument());
  });

  it('no READY resume → the 422 "generate first" message', async () => {
    loginAs(AMIR); // no generation seeded
    render(<SendWhatsAppButton />);
    await userEvent.click(screen.getByRole('button', { name: /send to whatsapp/i }));
    await waitFor(() =>
      expect(screen.getByText(/generate your resume first/i)).toBeInTheDocument(),
    );
  });
});

// ── Email-to-self ─────────────────────────────────────────────────────────────
describe('EmailResumeButton', () => {
  it('READY → emailed; missing → 422 handled', async () => {
    loginAs(AMIR);
    seedReady(AMIR);
    const { unmount } = render(<EmailResumeButton />);
    await userEvent.click(screen.getByRole('button', { name: /email to myself/i }));
    await waitFor(() => expect(screen.getByText(/emailed to you/i)).toBeInTheDocument());
    unmount();

    db.resumeGenerations.clear();
    render(<EmailResumeButton />);
    await userEvent.click(screen.getByRole('button', { name: /email to myself/i }));
    await waitFor(() =>
      expect(screen.getByText(/generate your resume first/i)).toBeInTheDocument(),
    );
  });
});

// ── Hub integration: the edit propagates to F1's preview + regenerate prompt ───
describe('ResumeExportHub — settings edits drive F1 preview + regenerate prompt', () => {
  it('flipping Show Passport Number ON updates the preview and prompts a regenerate', async () => {
    loginAs(AMIR);
    seedReady(AMIR); // hasGenerated → the "regenerate to apply" prompt is eligible

    render(<ResumeExportHub profile={profileOf(AMIR)} />);

    // Wait for the panel to load (getResume resolved).
    const passportSwitch = await screen.findByRole('switch', { name: /show passport number/i });
    // The F1 preview does NOT show a passport-number row yet (toggle off). Exact
    // match on the preview's <dt> — the panel's switch label also contains the
    // phrase "passport number", so a loose regex would false-match.
    expect(screen.queryByText('Passport number')).not.toBeInTheDocument();

    await userEvent.click(passportSwitch);

    // F1's preview reacts (a passport-number row appears) …
    await waitFor(() => expect(screen.getByText('Passport number')).toBeInTheDocument());
    // … and the honest "regenerate to apply" prompt shows (last PDF is stale).
    await waitFor(() =>
      expect(screen.getByText(/regenerate your resume to apply/i)).toBeInTheDocument(),
    );
  });
});

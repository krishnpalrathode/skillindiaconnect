import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/en/onboarding',
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({ get: () => null }),
}));

import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test-utils';
import { server } from '../../../mocks/server';
import { db, makeAccessToken, RESUME_FAIL_USER_ID } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import type { components } from '@skillindiaconnect/shared-types';
import {
  buildResumePreview,
  PASSPORT_NUMBER_PLACEHOLDER,
} from '../../../lib/resume/resumeViewModel';
import { ResumePreview } from '../ResumePreview';
import { DownloadResumeButton } from '../DownloadResumeButton';
import { PreviewExportStep } from '../../onboarding/steps/PreviewExportStep';

type CandidateProfile = components['schemas']['CandidateProfile'];
type ResumeSettings = components['schemas']['ResumeSettings'];
type ResumeGeneration = components['schemas']['ResumeGeneration'];

const mockReplace = vi.fn();
const BASE = `${window.location.origin}/api/v1`;
const AMIR = 'mock-user-candidate-1';

/** Register a token in MSW's session store so getAuthUser() resolves the user. */
function loginAs(userId: string) {
  const token = makeAccessToken(userId);
  setAccessToken(token);
  db.sessions.set(token, { userId, accessToken: token });
}

function profileOf(userId: string): CandidateProfile {
  return db.candidates.get(userId)!.profile;
}

const FAST_POLL = [10, 10, 10, 10, 10, 10];

beforeEach(() => {
  resetClient();
  mockReplace.mockReset();
  db.resumeGenerations.clear();
});

// ── The polling UX (THE point of the delayed-flip mock) ───────────────────────
describe('DownloadResumeButton — async generate→poll→download', () => {
  it('stays GENERATING while PENDING, then downloads ONLY once READY (never while pending)', async () => {
    loginAs(AMIR);
    const download = vi.fn();

    render(<DownloadResumeButton pollSchedule={FAST_POLL} timeoutMs={5000} download={download} />);

    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    // PENDING: the generating state shows; NO download, NO "ready".
    expect(screen.getByText(/generating your resume/i)).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByText(/your resume is ready/i)).not.toBeInTheDocument();

    // The delayed mock flips READY after 3 status polls → download fires then.
    await waitFor(() => expect(screen.getByText(/your resume is ready/i)).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(expect.stringContaining('http'));
    expect(screen.queryByText(/generating your resume/i)).not.toBeInTheDocument();
  });

  it('FAILED generation → the retry state, and download NEVER fires', async () => {
    loginAs(RESUME_FAIL_USER_ID); // this fixture's generations flip to FAILED
    const download = vi.fn();

    render(<DownloadResumeButton pollSchedule={FAST_POLL} timeoutMs={5000} download={download} />);
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(
      () => expect(screen.getByText(/couldn't generate your resume/i)).toBeInTheDocument(),
      {
        timeout: 4000,
      },
    );
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByText(/your resume is ready/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('polling budget spent with no READY → honest timeout copy, never a false-ready', async () => {
    loginAs(AMIR);
    // Force status to stay PENDING forever so the budget is what resolves it.
    server.use(
      http.get(`${BASE}/candidates/me/resume/status`, () =>
        HttpResponse.json({ data: { generationId: 'gen-x', status: 'PENDING' } }),
      ),
    );
    const download = vi.fn();

    render(<DownloadResumeButton pollSchedule={[10]} timeoutMs={40} download={download} />);
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() =>
      expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument(),
    );
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByText(/your resume is ready/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('an already-READY resume re-downloads without forcing a regenerate (and Regenerate stays available)', async () => {
    loginAs(AMIR);
    // Seed a READY generation so the download endpoint re-mints a url.
    db.resumeGenerations.set(AMIR, {
      generationId: 'gen-ready',
      status: 'READY',
      pollCount: 3,
      resumeId: `resume-${AMIR}`,
      generatedAt: new Date().toISOString(),
      settingsSnapshot: db.candidates.get(AMIR)!.resumeSettings,
    });
    const initial: ResumeGeneration = {
      generationId: 'gen-ready',
      status: 'READY',
      downloadUrl: 'https://mock-r2.example.com/resumes/amir/gen-ready.pdf?sig=mock',
      generatedAt: new Date().toISOString(),
    };
    const download = vi.fn();
    const generateSpy = vi.fn();
    server.use(
      http.post(`${BASE}/candidates/me/resume/generate`, () => {
        generateSpy();
        return HttpResponse.json(
          { data: { generationId: 'gen-2', status: 'PENDING' } },
          { status: 202 },
        );
      }),
    );

    render(<DownloadResumeButton initialGeneration={initial} download={download} />);

    // Starts READY (no auto-download on mount), Regenerate is available.
    expect(screen.getByText(/your resume is ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();

    // "Download again" re-mints + downloads — WITHOUT a regenerate.
    await userEvent.click(screen.getByRole('button', { name: /download again/i }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

// ── The preview mirrors the settings omission rules ───────────────────────────
describe('ResumePreview — reflects Resume Settings (mirrors the server)', () => {
  const baseSettings: ResumeSettings = {
    language: 'en',
    showPhone: true,
    showReligion: false,
    showFatherName: true,
    showPassportNumber: false,
    template: 'CLASSIC',
  };

  it('view model OMITS passportNumber when showPassportNumber is off, INCLUDES it when on', () => {
    const profile = profileOf(AMIR); // has a PASSPORT document

    const off = buildResumePreview(profile, { ...baseSettings, showPassportNumber: false });
    expect(off.passportNumber).toBeUndefined();

    const on = buildResumePreview(profile, { ...baseSettings, showPassportNumber: true });
    expect(on.passportNumber).toBe(PASSPORT_NUMBER_PLACEHOLDER);
  });

  it('does not render a passport-number row with the toggle off; renders it with the toggle on', () => {
    const profile = profileOf(AMIR);

    const { unmount } = render(
      <ResumePreview profile={profile} settings={{ ...baseSettings, showPassportNumber: false }} />,
    );
    expect(screen.queryByText(/passport number/i)).not.toBeInTheDocument();
    unmount();

    render(
      <ResumePreview profile={profile} settings={{ ...baseSettings, showPassportNumber: true }} />,
    );
    expect(screen.getByText(/passport number/i)).toBeInTheDocument();
  });

  it('is clearly labelled a PREVIEW, distinct from the downloadable PDF', () => {
    render(<ResumePreview profile={profileOf(AMIR)} settings={baseSettings} />);
    expect(screen.getByText(/download the PDF for the final document/i)).toBeInTheDocument();
  });
});

// ── Onboarding completion is preserved (resume is optional/non-blocking) ───────
describe('PreviewExportStep — Save & Continue reaches /dashboard without a resume', () => {
  it('completes onboarding even when no resume was generated', async () => {
    loginAs(AMIR);
    render(<PreviewExportStep profile={profileOf(AMIR)} onBack={vi.fn()} />);

    const finish = screen.getByRole('button', { name: /save & continue/i });
    await userEvent.click(finish);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/en/dashboard'));
  });
});

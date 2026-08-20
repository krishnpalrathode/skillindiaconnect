/**
 * The default "About you" text.
 *
 * It is short, but it goes out on real documents and it is shown to every
 * candidate who has not written their own, so the things worth pinning are: it
 * exists, it fits the column the API enforces, and it stays generic enough to
 * be true of anyone (no trade, no country, no invented experience).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_ABOUT_YOU } from '../summaryDraft';
import { SUMMARY_MAX_LENGTH } from '../../../components/resume/ResumeSummaryCard';

describe('DEFAULT_ABOUT_YOU', () => {
  it('fits the column the API enforces', () => {
    // VarChar(500) server-side: a longer default would be silently truncated
    // by the textarea's maxLength, or rejected on save.
    expect(DEFAULT_ABOUT_YOU.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
  });

  it('is substantial enough to be worth prefilling', () => {
    expect(DEFAULT_ABOUT_YOU.trim().length).toBeGreaterThan(100);
  });

  it('claims nothing specific about the candidate', () => {
    /*
      The whole point of a shared default is that it cannot be wrong for the
      person reading it. A trade, a country or a number of years would be a
      claim the system has not checked — and this text is shown before knowing
      anything about who is looking at it.
    */
    expect(DEFAULT_ABOUT_YOU).not.toMatch(/\d+\s*(year|yr)/i);
    expect(DEFAULT_ABOUT_YOU).not.toMatch(/electrician|welder|driver|plumber|nurse/i);
    expect(DEFAULT_ABOUT_YOU).not.toMatch(/india|dubai|gulf|qatar|oman|uae/i);
  });

  it('reads as complete sentences, not a fragment', () => {
    expect(DEFAULT_ABOUT_YOU.trim()).toMatch(/\.$/);
    expect(DEFAULT_ABOUT_YOU.split('.').filter((s) => s.trim()).length).toBeGreaterThanOrEqual(2);
  });
});

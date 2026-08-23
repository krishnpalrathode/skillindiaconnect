import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../../test-utils';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../i18n/messages/en.json';
import { PublishedNotice } from '../jobform/PublishedNotice';

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

describe('PublishedNotice — telling an employer their posting expires', () => {
  it('states the real deadline read off the job, not a hardcoded period', () => {
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={inDays(90)} onClose={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByText(/your job is live/i)).toBeInTheDocument();
    // The day count comes from the job's own autoArchiveAt, so changing
    // jobs.auto_archive_days in Settings changes this message with no code edit.
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it.each([45, 60, 90])('follows the platform setting — %s days', (days) => {
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={inDays(days)} onClose={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByText(String(days))).toBeInTheDocument();
  });

  /**
   * The correction that matters. The job transitions ACTIVE→ARCHIVED — it is not
   * deleted, and the employer keeps it with its applicants. Saying "deleted"
   * would have someone re-typing a posting they never lost.
   */
  it('says ARCHIVED and promises the job is kept — never "deleted"', () => {
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={inDays(90)} onClose={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByText(/archived automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/stays in my jobs/i)).toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  /**
   * When the platform requires admin approval the job goes to PENDING_REVIEW and
   * `autoArchiveAt` is null — the countdown has not started. Showing a date here
   * would promise a deadline the server has not set.
   */
  it('does not invent a deadline for a job still awaiting review', () => {
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={null} onClose={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByText(/sent for review/i)).toBeInTheDocument();
    expect(screen.getByText(/starts counting once it is approved/i)).toBeInTheDocument();
    expect(screen.queryByText(/candidates can see and apply/i)).toBeNull();
  });

  it('rounds part-days UP so the posting is never shown as shorter than it is', () => {
    // 44 days and 20 hours must read as 45, not 44.
    const almost45 = new Date(Date.now() + 44 * 86400000 + 20 * 3600000).toISOString();
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={almost45} onClose={vi.fn()} />
      </Wrap>,
    );
    expect(screen.getByText('45')).toBeInTheDocument();
  });

  it('acknowledging closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Wrap>
        <PublishedNotice autoArchiveAt={inDays(90)} onClose={onClose} />
      </Wrap>,
    );
    await user.click(screen.getByRole('button', { name: /got it/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

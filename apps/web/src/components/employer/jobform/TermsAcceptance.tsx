'use client';

import React, { useId, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JOB_POSTING_TERMS, JOB_POSTING_TERMS_VERSION } from '@/lib/jobs/jobPostingTerms';

/**
 * The job-posting terms, and the tick that records accepting them.
 *
 * The clauses are READABLE ON THE PAGE, not behind a link. An employer who has
 * to open a second tab to find out what they are agreeing to mostly does not,
 * and "they could have clicked through" is a weak answer when the point of the
 * tick is to show what was actually put in front of them. Collapsed by default
 * so the form stays scannable; expanding is one click and no navigation.
 *
 * The version is shown next to the heading because it is what gets stored — an
 * admin reading `2026-08-draft-1` on a job can match it to what was on screen.
 */
export function TermsAcceptance({
  accepted,
  onChange,
  error,
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const checkboxId = useId();
  const clausesId = useId();
  const errorId = error ? `${checkboxId}-error` : undefined;

  return (
    <section aria-labelledby="terms-heading" className="flex flex-col gap-4">
      <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
        >
          7
        </span>
        <div>
          <h3 id="terms-heading" className="text-base font-bold text-neutral-900">
            Terms for this posting
          </h3>
          <p className="mt-0.5 text-sm text-neutral-600">
            You accept these each time you post a job. They apply to this posting.
          </p>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-col rounded-xl border bg-white',
          error ? 'border-error ring-[3px] ring-error/25' : 'border-neutral-200',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={clausesId}
          className="flex items-center gap-3 rounded-t-xl px-4 py-3 text-start hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <FileText className="size-4 shrink-0 text-[#0F3D91]" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium text-neutral-900">
            Read the {JOB_POSTING_TERMS.length} terms
            <span className="ms-2 font-normal text-neutral-600">
              (version {JOB_POSTING_TERMS_VERSION})
            </span>
          </span>
          <ChevronDown
            className={cn('size-4 shrink-0 text-neutral-600 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {open && (
          <ol id={clausesId} className="flex flex-col gap-3 border-t border-neutral-100 px-4 py-4">
            {JOB_POSTING_TERMS.map((clause, i) => (
              <li key={clause.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 w-5 shrink-0 text-xs font-semibold tabular-nums text-neutral-600"
                >
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{clause.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{clause.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <label
          htmlFor={checkboxId}
          className="flex cursor-pointer items-start gap-3 border-t border-neutral-100 px-4 py-3.5"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={accepted}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={!!error}
            aria-describedby={errorId}
            aria-required
            className="mt-0.5 size-4 shrink-0 accent-primary-600 cursor-pointer"
          />
          <span className="text-sm text-neutral-900">
            I have read and accept these terms for this job posting, and I am authorised to accept
            them for my company.
          </span>
        </label>
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-error-fg">
          {error}
        </p>
      )}
    </section>
  );
}

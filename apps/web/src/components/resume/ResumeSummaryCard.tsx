'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { patchCandidateProfile } from '@/lib/api/candidate';

/**
 * Mirrors `SUMMARY_MAX_LENGTH` in `apps/api/src/candidate/candidate.constants.ts`
 * and `@db.VarChar(500)` on the column. Restated here because apps/web is
 * HTTP-only and cannot import from apps/api — the server still rejects anything
 * longer, so this cap is a courtesy that stops the candidate from typing into a
 * 400, never the enforcement.
 */
export const SUMMARY_MAX_LENGTH = 500;

interface ResumeSummaryCardProps {
  /**
   * A first draft built from the candidate's own profile, used ONLY when they
   * have not written a summary yet. Never overwrites saved text.
   */
  suggestion?: string | null;
  /** The saved value, or null when they have not written one. */
  value: string | null;
  /** Called with the newly SAVED value so the live preview updates with it. */
  onSaved: (summary: string | null) => void;
}

/**
 * The candidate's intro — the one part of the resume they write themselves.
 *
 * EXPLICIT SAVE rather than the autosave used by the profile's inline sections.
 * The difference is deliberate: those edit one short field at a time, where a
 * blur-to-save is unambiguous. This is a paragraph someone drafts over a minute
 * or two, pausing mid-sentence — autosaving that would push half-written
 * sentences into the resume, and a candidate who wanders off mid-thought would
 * find their PDF quoting a fragment. The Save button is the commit.
 *
 * Clearing is a first-class action, not an edge case: the field starts empty for
 * every existing candidate, and someone who dislikes what they wrote must be able
 * to get back to "no summary at all". An emptied box saves as null, and every PDF
 * template then omits the block rather than printing an empty rule.
 */
export function ResumeSummaryCard({ value, suggestion, onSaved }: ResumeSummaryCardProps) {
  const t = useTranslations('resume.summary');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  /*
    Seeded with the SAVED text, or the generated draft when there is none.

    The order matters: a saved summary always wins, so the suggestion can never
    overwrite something the candidate wrote. And it is only an initial value —
    it goes in the box for them to edit and Save, it is not persisted behind
    their back.
  */
  const [draft, setDraft] = useState(value ?? suggestion ?? '');
  const [busy, setBusy] = useState(false);

  // Compare TRIMMED against TRIMMED: trailing whitespace is not a change worth
  // a request, and the server stores the trimmed form anyway.
  const trimmed = draft.trim();
  const dirty = trimmed !== (value ?? '').trim();

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      // The empty string clears it — the contract's documented way to say "no
      // summary", which the API maps to NULL.
      const updated = await patchCandidateProfile({ summary: trimmed });
      // Trust the server's echo over the local draft, so a server-side
      // normalisation is what lands in the preview.
      const saved = updated.summary?.trim() || null;
      setDraft(saved ?? '');
      onSaved(saved);
      showToast({ message: tToast('saved'), variant: 'success' });
    } catch {
      showToast({ message: tToast('saveFailed'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]"
          aria-hidden="true"
        >
          <PenLine className="size-4" />
        </span>
        <div className="flex-1">
          <label htmlFor="resume-summary" className="text-sm font-bold text-neutral-800">
            {t('title')}
          </label>
          <p className="mt-0.5 text-xs text-neutral-600">{t('hint')}</p>
        </div>
      </div>

      <textarea
        id="resume-summary"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, SUMMARY_MAX_LENGTH))}
        placeholder={t('placeholder')}
        rows={4}
        maxLength={SUMMARY_MAX_LENGTH}
        disabled={busy}
        className="mt-3 w-full resize-y rounded-xl border border-neutral-300 p-3 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:bg-neutral-50"
      />

      <div className="mt-2.5 flex items-center justify-between gap-3">
        {/* A cap with no counter is a surprise when the box silently stops
            accepting typing — the same reasoning as the admin notes panel. */}
        <span className="text-xs tabular-nums text-neutral-600" aria-live="polite">
          {t('counter', { used: draft.length, max: SUMMARY_MAX_LENGTH })}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          // Disabled only when there is nothing to save. Unlike the export
          // buttons — which stay enabled so they can explain a refusal — "no
          // changes" needs no explanation.
          disabled={busy || !dirty}
        >
          {busy && <Spinner size={14} label="" />}
          {t('save')}
        </Button>
      </div>
    </section>
  );
}

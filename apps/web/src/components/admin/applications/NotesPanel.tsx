'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Trash2 } from 'lucide-react';
import { listNotes, addNote, deleteNote, type NoteEntry } from '@/lib/api/admin-applications';
import { ApiRequestError } from '@/lib/api/client';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

const MAX_NOTE_LENGTH = 2000;

/**
 * Internal notes — for the admin/support team ONLY. The internal-only label is
 * part of the panel's accessible description, not decoration: it is
 * structurally true (S6b-B2 proves on raw JSON that notes never serialize into
 * candidate/employer contexts) and the admin writing one should know it.
 *
 * Delete is author-or-SUPER_ADMIN server-side; the client doesn't know its own
 * user id, so the button renders and a NOT_NOTE_AUTHOR 403 is rendered calmly.
 * RBAC: applications.notes (the frozen contract's key).
 */
export function NotesPanel({ applicationId }: { applicationId: string }) {
  const t = useTranslations('admin.applications.notes');
  const [notes, setNotes] = useState<NoteEntry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await listNotes(applicationId));
    } catch {
      setNotes([]);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      await addNote(applicationId, draft.trim());
      setDraft('');
      void load();
    } catch {
      setNote(t('addFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(noteId: string) {
    setNote(null);
    try {
      await deleteNote(applicationId, noteId);
      void load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'NOT_NOTE_AUTHOR') {
        // The server's authorship rule, rendered calmly.
        setNote(t('notAuthor'));
      } else {
        setNote(t('deleteFailed'));
      }
    }
  }

  return (
    <PermissionGate permission="applications.notes">
      <section
        aria-labelledby="notes-heading"
        aria-describedby="notes-internal-label"
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
      >
        <div>
          <h2 id="notes-heading" className="text-sm font-semibold text-neutral-900">
            {t('heading')}
          </h2>
          {/* Unmissable, and part of the accessible description. */}
          <p
            id="notes-internal-label"
            className="mt-1 flex w-fit items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700"
          >
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            {t('internalOnly')}
          </p>
        </div>

        {notes === null && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        )}

        {notes !== null && notes.length === 0 && (
          <p role="status" className="text-sm text-neutral-600">
            {t('empty')}
          </p>
        )}

        {notes !== null && notes.length > 0 && (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-600">
                    {t('byline', {
                      role: n.authorRole,
                      date: new Date(n.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-neutral-800">{n.body}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void remove(n.id)}
                  aria-label={t('deleteAria')}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {note && (
          <p role="status" className="rounded-lg bg-neutral-100 p-2 text-xs text-neutral-600">
            {note}
          </p>
        )}

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="new-note" className="sr-only">
            {t('addLabel')}
          </label>
          <textarea
            id="new-note"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            placeholder={t('addPlaceholder')}
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            className="w-full rounded-lg border border-neutral-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
          <div className="flex items-center justify-between gap-2">
            {/* The length counter — a cap without a counter is a surprise. */}
            <span className="text-xs tabular-nums text-neutral-600" aria-live="polite">
              {t('counter', { used: draft.length, max: MAX_NOTE_LENGTH })}
            </span>
            <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0}>
              {busy && <Spinner size={14} label="" />}
              {t('add')}
            </Button>
          </div>
        </form>
      </section>
    </PermissionGate>
  );
}

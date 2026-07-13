'use client';

import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * The one focus-trapped dialog base the four employer-action dialogs share.
 * Same trap behavior as the S4 applicant dialogs: focus moves in on open,
 * Tab cycles inside, Escape and the backdrop close, focus returns on unmount.
 */
export function ActionDialogShell({
  titleId,
  title,
  busy,
  confirmLabel,
  confirmVariant = 'primary',
  confirmDisabled,
  onConfirm,
  onClose,
  cancelLabel,
  children,
}: {
  titleId: string;
  title: string;
  busy: boolean;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'destructive' | 'outline';
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  cancelLabel: string;
  children?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const nodes = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]),textarea,input,[href],[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    nodes()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      const items = nodes();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-neutral-900">
          {title}
        </h2>

        {children}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy && <Spinner size={14} label="" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

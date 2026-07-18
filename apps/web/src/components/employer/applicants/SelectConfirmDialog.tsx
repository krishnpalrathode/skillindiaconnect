'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface SelectConfirmDialogProps {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Select confirm — the copy carries real weight: a ONE-TIME WhatsApp to the
 * worker's phone. Plain and accurate; there is no "resend" here (that is S6).
 * Focus-trapped, Escape/overlay closes.
 */
export function SelectConfirmDialog({ name, busy, onConfirm, onClose }: SelectConfirmDialogProps) {
  const t = useTranslations('applicants.selectDialog');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const nodes = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
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
        aria-labelledby="select-dialog-title"
        className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="select-dialog-title" className="text-base font-semibold text-neutral-900">
          {t('title', { name })}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">{t('body')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="min-h-11">
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy} className="min-h-11">
            {t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

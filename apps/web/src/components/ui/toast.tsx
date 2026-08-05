'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** Milliseconds on screen. Defaults to 4000. */
  durationMs?: number;
}

interface ToastRecord extends Required<ToastOptions> {
  id: number;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toasts survive client-side navigation because the provider is mounted in the
 * ROOT layout — a `router.replace()` swaps the page below it without remounting
 * it. That is what lets "Logout successful" stay on screen while the user is
 * being sent to the landing page.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; icon_: string; bar: string }
> = {
  success: { icon: CheckCircle2, icon_: 'text-success-fg', bar: 'bg-success-fg' },
  error: { icon: XCircle, icon_: 'text-error-fg', bar: 'bg-error-fg' },
  warning: { icon: AlertTriangle, icon_: 'text-warning-fg', bar: 'bg-warning-fg' },
  info: { icon: Info, icon_: 'text-info-fg', bar: 'bg-info-fg' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, variant = 'success', durationMs = 4000 }: ToastOptions) => {
      // Date.now() collides when two toasts fire in the same millisecond, which
      // React then renders with duplicate keys. A counter cannot collide.
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, variant, durationMs }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

let nextId = 1;

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      // Fixed to the inline-end edge so it mirrors under dir="rtl".
      className="pointer-events-none fixed end-4 top-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const t = useTranslations('common');
  const { icon: Icon, icon_, bar } = VARIANT_STYLES[toast.variant];

  return (
    <div
      // Errors interrupt; everything else waits for a pause in speech.
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
      style={{ '--toast-duration': `${toast.durationMs}ms` } as React.CSSProperties}
      className="toast-item pointer-events-auto animate-toast-in overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
    >
      <div className="flex items-start gap-3 p-4">
        <Icon className={cn('mt-0.5 size-5 shrink-0', icon_)} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium text-neutral-900">{toast.message}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label={t('close')}
          className="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Countdown bar. Decorative — the message already carries the meaning. */}
      <div className="h-1 w-full bg-neutral-100" aria-hidden="true">
        <div
          className={cn(
            'toast-progress-bar h-full w-full origin-left animate-toast-progress rtl:origin-right',
            bar,
          )}
          style={{ animationDuration: `${toast.durationMs}ms` }}
        />
      </div>
    </div>
  );
}

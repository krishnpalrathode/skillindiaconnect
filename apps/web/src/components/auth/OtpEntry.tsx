'use client';

import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

const CELL_COUNT = 6;

interface OtpEntryProps {
  /** Called when all 6 digits are filled. Receives the 6-digit string. */
  onComplete: (code: string) => void;
  /** Disable all cells during a pending request. */
  disabled?: boolean;
  /** Clear the entry (set via key prop in the parent if needed). */
  className?: string;
}

/**
 * Reusable 6-cell OTP input.
 * - Auto-advances on digit entry
 * - Paste fills all cells from the first pasted digit
 * - Backspace in an empty cell moves focus to the previous cell
 * - numeric inputMode for mobile keyboards
 * - Each cell has its own aria-label
 *
 * Endpoint-agnostic: the caller wires onComplete to the correct verify endpoint
 * (login-verify here, phone-verify in onboarding).
 */
export function OtpEntry({ onComplete, disabled, className }: OtpEntryProps) {
  const refs = useRef<Array<HTMLInputElement | null>>(Array(CELL_COUNT).fill(null));
  const values = useRef<string[]>(Array(CELL_COUNT).fill(''));

  const notify = useCallback(() => {
    const code = values.current.join('');
    if (code.length === CELL_COUNT) onComplete(code);
  }, [onComplete]);

  const focus = (idx: number) => {
    refs.current[idx]?.focus();
  };

  const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const digit = raw.slice(-1)!;
    values.current[idx] = digit;
    e.target.value = digit;
    if (idx < CELL_COUNT - 1) focus(idx + 1);
    notify();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (values.current[idx]) {
        values.current[idx] = '';
        (e.target as HTMLInputElement).value = '';
      } else if (idx > 0) {
        values.current[idx - 1] = '';
        const prev = refs.current[idx - 1];
        if (prev) {
          prev.value = '';
          prev.focus();
        }
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      focus(idx - 1);
    } else if (e.key === 'ArrowRight' && idx < CELL_COUNT - 1) {
      focus(idx + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CELL_COUNT);
    if (!pasted) return;
    pasted.split('').forEach((digit, i) => {
      values.current[i] = digit;
      const input = refs.current[i];
      if (input) input.value = digit;
    });
    const nextFocus = Math.min(pasted.length, CELL_COUNT - 1);
    focus(nextFocus);
    notify();
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  return (
    <div className={cn('flex gap-2', className)} role="group" aria-label="One-time password">
      {Array.from({ length: CELL_COUNT }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`OTP digit ${i + 1} of ${CELL_COUNT}`}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={handleFocus}
          className={cn(
            'w-11 h-11 text-center text-lg font-semibold',
            'border border-border rounded-md bg-background text-foreground',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
            'disabled:opacity-50 disabled:pointer-events-none',
            'transition-colors',
          )}
        />
      ))}
    </div>
  );
}

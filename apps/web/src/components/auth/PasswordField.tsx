'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Strength scoring ─────────────────────────────────────────────────────────

function scorePassword(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score as 0 | 1 | 2 | 3 | 4;
}

const STRENGTH_META: Record<0 | 1 | 2 | 3 | 4, { label: string; color: string; bars: number }> = {
  0: { label: '', color: 'bg-neutral-200', bars: 0 },
  1: { label: 'Weak', color: 'bg-red-500', bars: 1 },
  2: { label: 'Fair', color: 'bg-yellow-500', bars: 2 },
  3: { label: 'Good', color: 'bg-blue-500', bars: 3 },
  4: { label: 'Strong', color: 'bg-green-500', bars: 4 },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PasswordFieldProps {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  showStrength?: boolean;
  strengthLabels?: { weak: string; fair: string; good: string; strong: string };
  className?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  name?: string;
  autoComplete?: string;
}

/**
 * Password field with show/hide toggle and optional strength meter.
 * Does NOT use Field's cloneElement to avoid the id being assigned to the wrapper
 * div instead of the actual input (which breaks getByLabelText in tests and
 * breaks the label association in the browser).
 */
export function PasswordField({
  id,
  label,
  value,
  placeholder,
  error,
  required,
  showStrength,
  strengthLabels,
  className,
  onChange,
  onBlur,
  name,
  autoComplete = 'current-password',
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const score = showStrength ? scorePassword(value ?? '') : 0;
  const meta = STRENGTH_META[score];
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>

      {/* Wrapper is purely visual; the Input carries the id so htmlFor works */}
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          name={name}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          hasError={!!error}
          aria-invalid={!!error || undefined}
          aria-required={required}
          aria-describedby={errorId}
          onChange={onChange}
          onBlur={onBlur}
          className="pe-11"
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          className={cn(
            'absolute inset-y-0 end-0 flex items-center pe-3',
            'text-neutral-500 hover:text-neutral-700',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded',
          )}
          tabIndex={0}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}

      {showStrength && value && (
        <div aria-live="polite" aria-label={`Password strength: ${meta.label}`}>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4].map((bar) => (
              <div
                key={bar}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  bar <= meta.bars ? meta.color : 'bg-neutral-200',
                )}
              />
            ))}
          </div>
          {meta.label && (
            <p className="text-xs text-neutral-500 mt-0.5">
              {strengthLabels
                ? ((
                    {
                      1: strengthLabels.weak,
                      2: strengthLabels.fair,
                      3: strengthLabels.good,
                      4: strengthLabels.strong,
                    } as Record<number, string>
                  )[score] ?? meta.label)
                : meta.label}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

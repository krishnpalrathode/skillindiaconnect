import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement;
}

/* Accessible form field atom: label + control + optional hint + error.
   Passes aria-describedby and aria-invalid down to the control via cloneElement.
   Every onboarding field should use this so a11y wiring is consistent. */
function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required,
    hasError: !!error,
  } as Record<string, unknown>);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>

      {control}

      {hint && !error && (
        <p id={hintId} className="text-xs text-neutral-500">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-error-fg font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

export { Field };
export type { FieldProps };

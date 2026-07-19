'use client';

import React from 'react';
import { Toggle } from '@/components/common/Toggle';

interface SettingToggleRowProps {
  /** The framed label — "Show [X] on your resume". */
  label: string;
  /** A brief note, e.g. the sensitive-default warning. Shown visibly AND folded
   *  into the switch's accessible name so it's announced with the control. */
  note?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** True while a PATCH is in flight — the switch is disabled to avoid double-sends. */
  saving?: boolean;
}

/**
 * One Resume Settings toggle (S7-F2), framed as "show this on your resume". The
 * switch's accessible name states WHAT it controls (and, for the sensitive
 * defaults, WHY it's off); on/off is conveyed by `role="switch"` + `aria-checked`
 * (the F0 Toggle). The note is also shown visibly for sighted users.
 */
export function SettingToggleRow({
  label,
  note,
  checked,
  onChange,
  saving,
}: SettingToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        {note && <p className="mt-0.5 text-xs text-neutral-600">{note}</p>}
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        label={note ? `${label}. ${note}` : label}
        disabled={saving}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
